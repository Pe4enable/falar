'use strict';
/* Falar — сервис хранения прогресса.
   Анонимные аккаунты + код восстановления + (опционально) email-вход.
   Хранилище: SQLite (встроенный node:sqlite). Авторизация: Bearer-токен (без cookie → CORS безопасен).
   Прогресс — произвольный JSON-блоб `S` клиента. Отдаётся за Caddy на /api/* того же домена.
   Зависимостей npm нет — только встроенные модули Node (>=22). */

const http = require('node:http');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = parseInt(process.env.PORT || '8080', 10);
const DB_PATH = process.env.DB_PATH || './data.db';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Falar <onboarding@resend.dev>';
const EMAIL_ENABLED = !!RESEND_API_KEY;
const MAX_BLOB = 256 * 1024;            // лимит размера прогресса
const OTP_TTL = 10 * 60 * 1000;         // срок жизни кода из письма
// CORS: разрешённые origin (через запятую в ALLOWED_ORIGINS) + любой localhost для разработки
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://falar.dubkov.eu').split(',').map(s => s.trim()).filter(Boolean);
function originAllowed(o) { return !!o && (ALLOWED_ORIGINS.includes(o) || /^http:\/\/localhost(:\d+)?$/.test(o)); }

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    recovery_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS progress (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS otp (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL
  );
`);

/* ---------- утилиты ---------- */
const now = () => Date.now();
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const genToken = () => crypto.randomBytes(32).toString('base64url');
const genId = () => crypto.randomBytes(16).toString('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const isEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // без неоднозначных 0/O/1/I
function genRecoveryCode() {
  const grp = () => Array.from({ length: 4 }, () => RC_ALPHABET[crypto.randomInt(RC_ALPHABET.length)]).join('');
  return `FALAR-${grp()}-${grp()}-${grp()}`;
}
const normRecovery = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const otp6 = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

/* ---------- rate-limit (в памяти) ---------- */
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const t = now(), rec = hits.get(key) || { c: 0, reset: t + windowMs };
  if (t > rec.reset) { rec.c = 0; rec.reset = t + windowMs; }
  rec.c++; hits.set(key, rec);
  return rec.c <= max;
}

/* ---------- запросы к БД ---------- */
const Q = {
  byToken: db.prepare('SELECT * FROM accounts WHERE token_hash = ?'),
  byEmail: db.prepare('SELECT * FROM accounts WHERE email = ?'),
  byRecovery: db.prepare('SELECT * FROM accounts WHERE recovery_hash = ?'),
  insAccount: db.prepare('INSERT INTO accounts (id, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?)'),
  setEmail: db.prepare('UPDATE accounts SET email = ?, email_verified = 1, updated_at = ? WHERE id = ?'),
  setRecovery: db.prepare('UPDATE accounts SET recovery_hash = ?, updated_at = ? WHERE id = ?'),
  setToken: db.prepare('UPDATE accounts SET token_hash = ?, updated_at = ? WHERE id = ?'),
  delAccount: db.prepare('DELETE FROM accounts WHERE id = ?'),
  delProgress: db.prepare('DELETE FROM progress WHERE account_id = ?'),
  getProgress: db.prepare('SELECT data, version FROM progress WHERE account_id = ?'),
  upsertProgress: db.prepare(`INSERT INTO progress (account_id, data, version, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at`),
  getOtp: db.prepare('SELECT * FROM otp WHERE email = ?'),
  upsertOtp: db.prepare(`INSERT INTO otp (email, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`),
  bumpOtp: db.prepare('UPDATE otp SET attempts = attempts + 1 WHERE email = ?'),
  delOtp: db.prepare('DELETE FROM otp WHERE email = ?'),
};
function createAccount() {
  const id = genId(), token = genToken(), t = now();
  Q.insAccount.run(id, sha256(token), t, t);
  return { id, token };
}
function publicAuth(account, token) {
  return { accountId: account.id, token: token || null, email: account.email || null, secured: !!(account.email || account.recovery_hash) };
}

/* ---------- email через Resend (HTTP API) ---------- */
async function sendEmail(to, code) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: EMAIL_FROM, to: [to],
      subject: `Falar — код подтверждения: ${code}`,
      text: `Ваш код подтверждения для Falar: ${code}\nКод действует 10 минут. Если вы его не запрашивали — просто игнорируйте письмо.`,
    }),
  });
  if (!res.ok) throw new Error('resend ' + res.status);
}

/* ---------- мини-HTTP ---------- */
function send(res, status, obj) {
  const body = obj === undefined ? '' : JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '', tooBig = false;
    req.on('data', (c) => { data += c; if (data.length > 520 * 1024) { tooBig = true; req.destroy(); } });
    req.on('end', () => { if (tooBig) return reject(new Error('too_big')); try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function authAccount(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return Q.byToken.get(sha256(m[1].trim())) || null;
}
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

const server = http.createServer(async (req, res) => {
  // CORS (токен в заголовке, cookie не используются). Отражаем origin только из белого списка.
  const origin = req.headers.origin;
  if (originAllowed(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;
  const ip = ipOf(req);

  try {
    if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true });
    if (method === 'GET' && path === '/api/config') return send(res, 200, { emailEnabled: EMAIL_ENABLED });

    if (method === 'POST' && path === '/api/account') {
      if (!rateLimit('acc:' + ip, 60, 3600e3)) return send(res, 429, { error: 'rate' });
      const { id, token } = createAccount();
      return send(res, 200, { accountId: id, token, secured: false, email: null });
    }

    // дальше — требуется тело и/или авторизация
    const body = (method === 'POST' || method === 'PUT' || method === 'DELETE') ? await readJson(req).catch(() => null) : {};
    if (body === null) return send(res, 400, { error: 'bad_json' });

    if (method === 'POST' && path === '/api/recovery/login') {
      if (!rateLimit('rec:' + ip, 30, 3600e3)) return send(res, 429, { error: 'rate' });
      const code = normRecovery(body.code);
      if (code.length < 8) return send(res, 400, { error: 'bad_code' });
      const account = Q.byRecovery.get(sha256(code));
      if (!account) return send(res, 404, { error: 'not_found' });
      const token = genToken();
      Q.setToken.run(sha256(token), now(), account.id);
      return send(res, 200, publicAuth(account, token));
    }

    // эндпоинты ниже требуют Bearer
    const account = authAccount(req);
    if (!account) return send(res, 401, { error: 'no_token' });

    if (method === 'DELETE' && path === '/api/account') {
      Q.delProgress.run(account.id); Q.delAccount.run(account.id);
      return send(res, 200, { ok: true });
    }

    if (method === 'GET' && path === '/api/progress') {
      const row = Q.getProgress.get(account.id);
      if (!row) { res.writeHead(204); return res.end(); }
      return send(res, 200, { data: JSON.parse(row.data), version: row.version });
    }

    if (method === 'PUT' && path === '/api/progress') {
      const data = body.data;
      if (data === undefined || typeof data !== 'object' || data === null) return send(res, 400, { error: 'bad_data' });
      const json = JSON.stringify(data);
      if (json.length > MAX_BLOB) return send(res, 413, { error: 'too_large' });
      const row = Q.getProgress.get(account.id);
      const curVer = row ? row.version : 0;
      if ((body.baseVersion | 0) !== curVer) return send(res, 409, { error: 'conflict', data: row ? JSON.parse(row.data) : null, version: curVer });
      const ver = curVer + 1;
      Q.upsertProgress.run(account.id, json, ver, now());
      return send(res, 200, { version: ver });
    }

    if (method === 'POST' && path === '/api/recovery/create') {
      const code = genRecoveryCode();
      Q.setRecovery.run(sha256(normRecovery(code)), now(), account.id);
      return send(res, 200, { code });
    }

    if (method === 'POST' && path === '/api/email/start') {
      if (!EMAIL_ENABLED) return send(res, 503, { error: 'email_disabled' });
      const email = normEmail(body.email);
      if (!isEmail(email)) return send(res, 400, { error: 'bad_email' });
      if (!rateLimit('otp:' + email, 5, 3600e3) || !rateLimit('otpip:' + ip, 20, 3600e3)) return send(res, 429, { error: 'rate' });
      const code = otp6();
      Q.upsertOtp.run(email, sha256(code), now() + OTP_TTL, now());
      try { await sendEmail(email, code); } catch (e) { return send(res, 502, { error: 'send_failed' }); }
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && path === '/api/email/verify') {
      if (!EMAIL_ENABLED) return send(res, 503, { error: 'email_disabled' });
      const email = normEmail(body.email);
      const rec = Q.getOtp.get(email);
      if (!rec) return send(res, 400, { error: 'no_otp' });
      if (now() > rec.expires_at) { Q.delOtp.run(email); return send(res, 400, { error: 'expired' }); }
      if (rec.attempts >= 6) { Q.delOtp.run(email); return send(res, 429, { error: 'too_many' }); }
      if (rec.code_hash !== sha256(String(body.code || '').trim())) { Q.bumpOtp.run(email); return send(res, 400, { error: 'bad_code' }); }
      Q.delOtp.run(email);
      const owner = Q.byEmail.get(email);
      if (owner && owner.id !== account.id) {
        const token = genToken();
        Q.setToken.run(sha256(token), now(), owner.id);
        return send(res, 200, Object.assign({ mode: 'login' }, publicAuth(owner, token)));
      }
      try { Q.setEmail.run(email, now(), account.id); }
      catch (e) { return send(res, 409, { error: 'email_taken' }); }
      const updated = Q.byToken.get(account.token_hash);
      return send(res, 200, Object.assign({ mode: 'link' }, publicAuth(updated, null)));
    }

    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error('err', e && e.message);
    return send(res, 500, { error: 'server' });
  }
});

server.listen(PORT, () => console.log(`falar-progress on :${PORT} (email ${EMAIL_ENABLED ? 'on' : 'off'}, db ${DB_PATH})`));
