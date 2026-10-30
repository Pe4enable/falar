'use strict';
/* Falar — веб-версия для тестирования. Контент: window.FALAR_CONTENT (content.js).
   Прогресс — в localStorage. Озвучка — Web Speech API (pt-PT). */

const LESSONS = window.FALAR_CONTENT.lessons;
const ALL_PHRASES = {};           // id -> {phrase, lessonId}
LESSONS.forEach(l => l.phrases.forEach(p => { ALL_PHRASES[p.id] = { p, lessonId: l.id }; }));
const TOTAL_PHRASES = Object.keys(ALL_PHRASES).length;

/* режимы практики: ротация по кругу после каждой сессии (Перевод → Аудио → Речь → Плитки) */
const MODE_ORDER = ['translate', 'audio', 'speak', 'builder'];
const WORD_MODES = ['translate', 'reverse', 'audio', 'speak'];
const MODE_LABEL = { translate: 'Перевод', audio: 'Аудио', builder: 'Плитки', speak: 'Речь', reverse: 'Обратно' };
/* допуск к экзамену: из последних 100 ПЛИТОК (режим builder) урока верных ≥ 90;
   окно хранится в ld.hist и переживает выход из сессии */
const HIST_WINDOW = 100;
const HIST_PASS = 90;

/* португальский — pro-drop: подлежащее-местоимение можно опускать.
   Ответ без местоимения тоже считается правильным. */
const SUBJ_PRON_NORM = new Set(['eu', 'tu', 'ele', 'ela', 'voce', 'nos', 'vos', 'eles', 'elas', 'voces']);
function normWord(w) { return String(w).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function isSubjPron(w) { return SUBJ_PRON_NORM.has(normWord(w)); }
// все допустимые варианты порядка слов: полный + с выброшенными подлежащими-местоимениями
function answerVariants(words) {
  const idx = [];
  words.forEach((w, i) => { if (isSubjPron(w)) idx.push(i); });
  if (!idx.length) return [words];
  const variants = [];
  for (let mask = 0; mask < (1 << idx.length); mask++) {
    const drop = new Set();
    for (let b = 0; b < idx.length; b++) if (mask & (1 << b)) drop.add(idx[b]);
    variants.push(words.filter((_, i) => !drop.has(i)));
  }
  return variants;
}
// проверка собранной фразы (плитки): принимает любой допустимый вариант
function evalBuilder(slotWords, correctWords) {
  const variants = answerVariants(correctWords);
  for (const v of variants) {
    if (slotWords.length === v.length && slotWords.every((w, i) => w === v[i])) return { correct: true, ref: v };
  }
  const sameLen = variants.find(v => v.length === slotWords.length);
  return { correct: false, ref: sameLen || correctWords };
}

/* ---------------- разбор ошибки в плитках (RU) ----------------
   Сравниваем собранный ответ с ближайшим допустимым вариантом (с учётом pro-drop)
   через LCS-выравнивание и строим одно предложение:
   слово на месте → зелёное; лишнее/не на месте → красное зачёркнутое;
   пропущенное → вписано красным. */
function lcsLen(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  return dp;
}
function lcsDiff(a, b) {
  const dp = lcsLen(a, b);
  const out = []; let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ w: a[i], type: 'ok' }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ w: a[i], type: 'extra' }); i++; }
    else { out.push({ w: b[j], type: 'missing' }); j++; }
  }
  while (i < a.length) { out.push({ w: a[i], type: 'extra' }); i++; }
  while (j < b.length) { out.push({ w: b[j], type: 'missing' }); j++; }
  return out;
}
// строим дифф против самого «близкого» допустимого варианта (макс. LCS с ответом)
function diffBuilder(userWords, correctWords) {
  let best = correctWords, bestScore = -1;
  for (const v of answerVariants(correctWords)) {
    const score = lcsLen(userWords, v)[0][0];
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return lcsDiff(userWords, best);
}
// короткое правило-объяснение из диффа + метаданных фразы
function builderExplain(diff, p) {
  const extras = diff.filter(d => d.type === 'extra').map(d => d.w);
  const missing = diff.filter(d => d.type === 'missing').map(d => d.w);
  if (!extras.length && !missing.length) return '';
  // не та форма глагола: лишнее и пропущенное слово с общим корнем
  for (const e of extras) for (const mw of missing) {
    const a = normWord(e), b = normWord(mw);
    let common = 0; const lim = Math.min(a.length, b.length);
    while (common < lim && a[common] === b[common]) common++;
    if (common >= 3 && a !== b) return `Не та форма: нужно «${mw}», а не «${e}».`;
  }
  // те же слова, но не на своих местах
  const es = extras.slice().sort().join('|'), ms = missing.slice().sort().join('|');
  if (extras.length && es === ms) return 'Порядок слов: слова верные, но стоят не на своих местах.';
  const parts = [];
  if (missing.length) parts.push('Пропущено: ' + missing.map(w => '«' + w + '»').join(', '));
  if (extras.length) parts.push('Лишнее: ' + extras.map(w => '«' + w + '»').join(', '));
  return parts.join('. ') + '.';
}
function diffSentenceHTML(diff) {
  return diff.map(d =>
    d.type === 'ok' ? `<span class="diff-ok">${esc(d.w)}</span>`
      : d.type === 'missing' ? `<span class="diff-missing">${esc(d.w)}</span>`
        : `<span class="diff-extra">${esc(d.w)}</span>`).join(' ');
}

/* ---------------- состояние ---------------- */
const STORE_KEY = 'falar-state-v1';
/* анонимная аналитика (Umami): отправка обучающих событий. Уважает Do-Not-Track. */
const APP_LANG = (typeof window !== 'undefined' && window.FALAR_LANG) ? window.FALAR_LANG : (STORE_KEY.indexOf('-en-') >= 0 ? 'en' : 'ru');
function track(name, data) {
  try { if (window.umami && window.umami.track) window.umami.track(name, Object.assign({ lang: APP_LANG }, data || {})); } catch (e) {}
}
const DEFAULTS = {
  onboarded: false,
  theme: 'system',                 // system | light | dark
  dayGoal: 20,
  day: { date: '', done: 0 },
  streak: 0, bestStreak: 0, lastActive: '',
  settings: { rate: 0.95, autoSpeak: true, voiceURI: '', defaultMode: 'translate', sound: true },
  phrases: {},                     // id -> {box, due, seen, right, wrong, learned}
  lessons: {},                     // id -> {theoryRead, examBest}
  words1000: { items: {} },        // RU-режим «1000 слов»: pt -> {box,due,seen,right,wrong,learned}
  verbTrainer: { mode: 'all', cells: {}, mastered: [], active: [] },  // RU-тренажёр форм глаголов
  nudgeSecureDismissed: false,     // закрыто ли напоминание «защитить прогресс»
};
let S = load();
function load() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); scheduleSync(); }
function persistLocal() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }   // запись без планирования пуша

/* ---------------- синхронизация прогресса с сервером (durable) ----------------
   localStorage — рабочий кеш; источник истины — бэкенд на /api. Авторизация — Bearer-токен,
   хранится ОТДЕЛЬНО от S (ключ AUTH_KEY), чтобы серверный блоб его не затирал. RU и EN → разные
   аккаунты (AUTH_KEY выводится из STORE_KEY). Всё best-effort: офлайн/недоступный бэкенд не ломают app. */
const AUTH_KEY = STORE_KEY.replace('-state-', '-auth-');
const API_BASE = (function () {
  try { const o = localStorage.getItem('falar-api'); if (o) return o; } catch (e) {}   // dev-оверрайд для локальной отладки
  return (typeof window !== 'undefined' && window.FALAR_API_BASE) ? window.FALAR_API_BASE : '/api';
})();
let AUTH = authLoad();
function authLoad() { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || '{}'); } catch (e) { return {}; } }
function authSave() { try { localStorage.setItem(AUTH_KEY, JSON.stringify(AUTH)); } catch (e) {} }
let syncDirty = false, syncing = false, pushTimer = null, syncStatus = 'local', syncEmailEnabled = false;
function setSyncStatus(s) { syncStatus = s; if (V && V.name === 'account') render(); }
async function api(method, path, body, useAuth) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (useAuth !== false && AUTH.token) headers['Authorization'] = 'Bearer ' + AUTH.token;
  const res = await fetch(API_BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}
// эвристика «сколько прогресса» — для разрешения конфликтов без потери данных
function progressScore(s) {
  let n = 0; if (!s) return 0;
  try {
    const ph = s.phrases || {}; for (const k in ph) { if (ph[k] && ph[k].learned) n += 2; n += (ph[k] && ph[k].seen) || 0; }
    const ls = s.lessons || {}; for (const k in ls) n += Math.round(((ls[k] || {}).examBest || 0) / 10);
    n += (((s.words1000 || {}).learned) || []).length * 2;
    const vt = ((s.verbTrainer || {}).cells) || {}; for (const k in vt) if ((vt[k].streak || 0) >= 3) n++;
    n += ((s.day || {}).done) || 0;
  } catch (e) {}
  return n;
}
function stripMeta(s) { const c = Object.assign({}, s); delete c._v; return c; }
function adoptServer(data, ver) {
  S = Object.assign({}, DEFAULTS, data || {});
  S._v = ver || 0;
  persistLocal();
  try { render(); } catch (e) {}
}
function scheduleSync() {
  if (!AUTH.token) return;
  syncDirty = true;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushProgress, 4000);
}
async function pushProgress(force) {
  if (!AUTH.token || syncing) return;
  if (!syncDirty && !force) return;
  syncing = true; setSyncStatus('sync');
  try {
    const r = await api('PUT', '/progress', { data: stripMeta(S), baseVersion: S._v || 0 });
    if (r.status === 200 && r.data) { S._v = r.data.version; syncDirty = false; persistLocal(); setSyncStatus('ok'); }
    else if (r.status === 409 && r.data) {
      const localScore = progressScore(S), serverScore = progressScore(r.data.data);
      if (serverScore > localScore) { adoptServer(r.data.data, r.data.version); syncDirty = false; setSyncStatus('ok'); }
      else { S._v = r.data.version; persistLocal(); syncing = false; return pushProgress(true); }  // перезапишем актуальную версию
    } else if (r.status === 401) { AUTH.token = null; authSave(); setSyncStatus('local'); }
    else setSyncStatus('off');
  } catch (e) { setSyncStatus('off'); }
  syncing = false;
}
async function pullProgress() {
  try {
    const r = await api('GET', '/progress');
    if (r.status === 401) { AUTH.token = null; authSave(); setSyncStatus('local'); return; }
    if (r.status === 204) { S._v = 0; persistLocal(); if (progressScore(S) > 0) await pushProgress(true); else setSyncStatus('ok'); return; }
    if (r.status === 200 && r.data) {
      const serverScore = progressScore(r.data.data), localScore = progressScore(S);
      if (localScore === 0 || (r.data.version > (S._v || 0) && serverScore >= localScore)) adoptServer(r.data.data, r.data.version);
      else { S._v = r.data.version; persistLocal(); await pushProgress(true); }
      setSyncStatus('ok');
    }
  } catch (e) { setSyncStatus('off'); }
}
async function ensureAccount() {
  if (AUTH.token) return true;
  try {
    const r = await api('POST', '/account', {}, false);
    if (r.status === 200 && r.data && r.data.token) { AUTH = { token: r.data.token, accountId: r.data.accountId, secured: false, email: null }; authSave(); return true; }
  } catch (e) {}
  return false;
}
async function syncInit() {
  if (!(typeof window !== 'undefined' && window.fetch)) return;
  try { const c = await api('GET', '/config', undefined, false); if (c.data) syncEmailEnabled = !!c.data.emailEnabled; } catch (e) {}
  const ok = await ensureAccount();
  if (!ok) { setSyncStatus('off'); return; }
  await pullProgress();
}
if (typeof window !== 'undefined') window.addEventListener('online', () => { if (syncDirty) pushProgress(); });

const todayStr = () => new Date().toISOString().slice(0, 10);
const yesterdayStr = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
function touchDay() {
  if (S.day.date !== todayStr()) S.day = { date: todayStr(), done: 0 };
}
function markActivity() {
  touchDay();
  S.day.done++;
  if (S.lastActive !== todayStr()) {
    S.streak = (S.lastActive === yesterdayStr()) ? S.streak + 1 : 1;
    S.bestStreak = Math.max(S.bestStreak, S.streak);
    S.lastActive = todayStr();
  }
  save();
}

/* ---------------- SRS (упрощённый Лейтнер) ---------------- */
const BOXES = [10 * 60e3, 864e5, 3 * 864e5, 7 * 864e5, 14 * 864e5]; // 10 мин, 1, 3, 7, 14 дней
function pdata(id) {
  return S.phrases[id] || (S.phrases[id] = { box: 0, due: 0, seen: 0, right: 0, wrong: 0, learned: false });
}
function grade(id, ok) {
  const p = pdata(id);
  p.seen++;
  if (ok) { p.right++; p.learned = true; p.box = Math.min(p.box + 1, BOXES.length - 1); }
  else { p.wrong++; p.box = 0; }
  p.due = Date.now() + BOXES[p.box];
  markActivity();
}
function dueIds() {
  const now = Date.now();
  return Object.keys(S.phrases).filter(id => S.phrases[id].seen > 0 && S.phrases[id].due <= now && ALL_PHRASES[id]);
}

/* ---------------- режим «1000 слов» (RU): SRS по словам ---------------- */
function W1K() { return (window.FALAR_CONTENT.words) || []; }
function w1kHas() { return APP_LANG === 'ru' && W1K().length > 0; }
function w1kState() {
  const s = S.words1000 || (S.words1000 = {});
  if (!s.items) s.items = {};
  if (!Array.isArray(s.learned)) s.learned = [];
  if (!Array.isArray(s.active)) s.active = [];
  return s;
}
// миграция со старого Лейтнера: слова с box≥3 / learned считаем изученными (streak=3)
function w1kMigrate() {
  const s = w1kState();
  let changed = false;
  for (const pt of Object.keys(s.items)) {
    const it = s.items[pt];
    if (it && it.streak === undefined) {
      const was = it.box >= 3;   // старый Лейтнер: box≥3 ≈ освоено (флаг learned ставился после 1 верного — не считаем)
      s.items[pt] = { streak: was ? 3 : 0 };
      if (was && !s.learned.includes(pt)) s.learned.push(pt);
      changed = true;
    }
  }
  if (changed) save();
}
function w1kData(pt) { const s = w1kState(); return s.items[pt] || (s.items[pt] = { streak: 0 }); }
function w1kStreak(pt) { const it = w1kState().items[pt]; return it ? (it.streak || 0) : 0; }
function w1kIsLearned(pt) { return w1kState().learned.includes(pt); }
function w1kLearnedCount() { return w1kState().learned.length; }
function w1kPool() { const set = new Set(w1kState().learned); return W1K().filter(w => !set.has(w.pt)); }
// активное окно урока = всегда 5 самых частотных ещё не изученных слов
// (частые слова попадаются, пока не будут изучены; «Изучать заново» сразу возвращает слово в окно)
function w1kRefillActive() {
  const s = w1kState();
  s.active = w1kPool().slice(0, 5).map(w => w.pt);
  return s.active;
}
// 3 верных подряд → слово изучено и уходит из урока; возвращает true при первом достижении
function w1kGradeWord(pt, ok) {
  const d = w1kData(pt);
  d.streak = ok ? (d.streak || 0) + 1 : 0;
  markActivity();
  if (d.streak >= 3 && !w1kState().learned.includes(pt)) {
    w1kState().learned.push(pt);
    const s = w1kState(); s.active = s.active.filter(x => x !== pt);
    return true;
  }
  return false;
}
// 4 варианта ответа: правильный + 3 дистрактора того же типа речи (если есть)
function w1kOptions(w, dir) {
  const field = dir === 'pt2ru' ? 'ru' : 'pt';
  const correct = w[field];
  const norm = s => String(s).toLowerCase().trim();
  // дистрактор не должен совпадать с правильным ни по PT, ни по RU (иначе ложно-неверный вариант)
  const distinct = x => norm(x.pt) !== norm(w.pt) && norm(x.ru) !== norm(w.ru);
  const same = W1K().filter(x => x.pos === w.pos && distinct(x));
  const pool = shuffle(same.length >= 3 ? same : W1K().filter(distinct));
  const opts = [], seen = new Set([norm(correct)]);
  for (const x of pool) { const v = x[field]; if (!seen.has(norm(v))) { seen.add(norm(v)); opts.push(v); if (opts.length >= 3) break; } }
  const all = shuffle([correct].concat(opts));
  return { options: all, correctIndex: all.indexOf(correct) };
}
function w1kMakeCard(w, dir) {
  const o = w1kOptions(w, dir);
  return { pt: w.pt, ru: w.ru, pos: w.pos, dir, options: o.options, correctIndex: o.correctIndex };
}
// одно и то же слово не должно повторяться раньше, чем через 2 других (recent — последние 2 pt)
function w1kPickAvoidRecent(cands, recent) {
  const avail = (recent && recent.length) ? cands.filter(x => !recent.includes(x)) : cands;
  const pool = avail.length ? avail : cands;
  return pool[Math.floor(Math.random() * pool.length)];
}
function w1kPushRecent(recent, pt) { if (recent) { recent.push(pt); while (recent.length > 2) recent.shift(); } }
// карточка режима «урок»: случайное ещё не изученное слово из активного окна (5), не из последних 2
function w1kNextLearnCard(prevDir, recent) {
  const active = w1kRefillActive();
  const words = active.map(pt => W1K().find(x => x.pt === pt)).filter(w => w && !w1kIsLearned(w.pt));
  if (!words.length) return null;
  const chosen = w1kPickAvoidRecent(words.map(x => x.pt), recent);
  const wObj = words.find(x => x.pt === chosen) || words[0];
  w1kPushRecent(recent, wObj.pt);
  const dir = prevDir === 'pt2ru' ? 'ru2pt' : 'pt2ru';
  return w1kMakeCard(wObj, dir);
}
// карточка режима «повторение на выбивание»: слова из пула повторения с локальным streak<3, не из последних 2
function w1kNextReviewCard(ws) {
  const remaining = ws.reviewPool.filter(pt => (ws.reviewStreak[pt] || 0) < 3);
  if (!remaining.length) return null;
  if (!ws.recent) ws.recent = [];
  const pt = w1kPickAvoidRecent(remaining, ws.recent);
  w1kPushRecent(ws.recent, pt);
  const w = W1K().find(x => x.pt === pt);
  if (!w) { ws.reviewStreak[pt] = 3; return w1kNextReviewCard(ws); }
  ws.lastDir = ws.lastDir === 'pt2ru' ? 'ru2pt' : 'pt2ru';
  return w1kMakeCard(w, ws.lastDir);
}

/* ---------------- конъюгатор глаголов (RU-тренажёр форм) ----------------
   Регулярные парадигмы -ar/-er/-ir для 4 времён × 5 лиц + орфографические
   правила; неправильные формы берутся из FALAR_CONTENT.verbsIrr (приоритет). */
const VTENSES = ['presente', 'pretperf', 'imperf', 'futuro'];
const VTENSE_LABEL = { presente: 'Presente', pretperf: 'Pretérito Perfeito', imperf: 'Pretérito Imperfeito', futuro: 'Futuro' };
const VTENSE_HINT = { presente: 'Hoje', pretperf: 'Ontem', imperf: 'Antigamente', futuro: 'Amanhã' };
const VPERSONS = ['eu', 'tu', 'ele/ela', 'nós', 'eles/elas'];
const VPRON = ['eu', 'tu', 'ele', 'nós', 'eles'];
const REG_END = {
  ar: { presente: ['o', 'as', 'a', 'amos', 'am'], pretperf: ['ei', 'aste', 'ou', 'ámos', 'aram'], imperf: ['ava', 'avas', 'ava', 'ávamos', 'avam'] },
  er: { presente: ['o', 'es', 'e', 'emos', 'em'], pretperf: ['i', 'este', 'eu', 'emos', 'eram'], imperf: ['ia', 'ias', 'ia', 'íamos', 'iam'] },
  ir: { presente: ['o', 'es', 'e', 'imos', 'em'], pretperf: ['i', 'iste', 'iu', 'imos', 'iram'], imperf: ['ia', 'ias', 'ia', 'íamos', 'iam'] },
};
const FUT_END = ['ei', 'ás', 'á', 'emos', 'ão'];
function verbsIrr() { return (window.FALAR_CONTENT.verbsIrr) || {}; }
function conjugate(inf, tense, idx) {
  const irr = verbsIrr()[inf];
  if (irr && irr[tense]) return irr[tense][idx];
  if (tense === 'futuro') return inf + FUT_END[idx];
  // -uzir (produzir, traduzir, conduzir…): настоящее нерегулярно, 3-е лицо без -e (produz)
  if (tense === 'presente' && /uzir$/.test(inf)) { const st = inf.slice(0, -2); return [st + 'o', st + 'es', st, st + 'imos', st + 'em'][idx]; }
  // -uir (incluir, possuir, contribuir…), кроме -guir/-quir: гласный u даёт особые формы с ударениями
  if (/uir$/.test(inf) && !/guir$|quir$/.test(inf)) {
    const st = inf.slice(0, -2);   // "inclu"
    if (tense === 'presente') return [st + 'o', st + 'is', st + 'i', st + 'ímos', st + 'em'][idx];
    if (tense === 'pretperf') return [st + 'í', st + 'íste', st + 'iu', st + 'ímos', st + 'íram'][idx];
    if (tense === 'imperf') return [st + 'ía', st + 'ías', st + 'ía', st + 'íamos', st + 'íam'][idx];
  }
  const type = inf.slice(-2), stem = inf.slice(0, -2), ends = REG_END[type];
  if (!ends) return inf;
  let st = stem;
  if (tense === 'presente' && idx === 0 && (type === 'er' || type === 'ir')) {
    if (/c$/.test(st)) st = st.slice(0, -1) + 'ç';        // conhecer→conheço
    else if (/gu$/.test(st)) st = st.slice(0, -2) + 'g';  // distinguir→distingo
    else if (/g$/.test(st)) st = st.slice(0, -1) + 'j';   // proteger→protejo, dirigir→dirijo
  }
  if (tense === 'pretperf' && idx === 0 && type === 'ar') {
    if (/c$/.test(st)) st = st.slice(0, -1) + 'qu';        // ficar→fiquei
    else if (/g$/.test(st)) st = st + 'u';                 // chegar→cheguei
    else if (/ç$/.test(st)) st = st.slice(0, -1) + 'c';    // começar→comecei
  }
  return st + ends[tense][idx];
}
/* движок тренажёра: ячейка = (inf, tense, idx); освоена при streak≥3.
   Режим 'all' — все 20 форм (4×5), глагол освоен при ≥18/20.
   Режим 'lessons' — только глаголы и ФОРМЫ, встречавшиеся в уже открытых уроках. */
function VLIST() { return (window.FALAR_CONTENT.verbs) || []; }
function verbsHas() { return APP_LANG === 'ru' && VLIST().length > 0; }
function vtState() {
  const s = S.verbTrainer || (S.verbTrainer = { mode: 'all', cells: {}, mastered: [], active: [] });
  if (!s.cells) s.cells = {};
  if (!Array.isArray(s.active)) s.active = [];
  if (s.mode !== 'all' && s.mode !== 'lessons') s.mode = 'all';
  return s;
}
function vCellKey(inf, tense, idx) { return inf + '|' + tense + '|' + idx; }
function vCellStreak(inf, tense, idx) { const c = vtState().cells[vCellKey(inf, tense, idx)]; return c ? c.streak : 0; }
// формы (tense,idx), встречавшиеся в уже открытых уроках: detect по совпадению формы конъюгатора с токеном фразы
let _encCache = null, _encKey = '';
function encounteredVerbCells() {
  const key = LESSONS.map((l, i) => lessonUnlocked(i) ? 1 : 0).join('');
  if (_encCache && _encKey === key) return _encCache;
  const known = new Set(VLIST().map(v => v.inf)), map = {};
  LESSONS.forEach((l, i) => {
    if (!lessonUnlocked(i)) return;
    (l.phrases || []).forEach(p => {
      if (!p.verb) return;
      const v = String(p.verb).toLowerCase().trim();
      const inf = known.has(v) ? v : (known.has(v.split(/\s+/).pop()) ? v.split(/\s+/).pop() : null);
      if (!inf) return;
      const toks = p.pt.toLowerCase().replace(/[.!?…,«»:;()]/g, ' ').split(/\s+/).filter(Boolean);
      for (const t of VTENSES) for (let idx = 0; idx < 5; idx++) {
        const f = conjugate(inf, t, idx);
        if (f && toks.includes(f.toLowerCase())) (map[inf] || (map[inf] = new Set())).add(t + '|' + idx);
      }
    });
  });
  _encKey = key; _encCache = map; return map;
}
// набор актуальных ячеек глагола для текущего режима
function verbCells(inf) {
  if (vtState().mode === 'lessons') {
    const set = encounteredVerbCells()[inf];
    return set ? [...set].map(k => { const a = k.split('|'); return { tense: a[0], idx: +a[1] }; }) : [];
  }
  const all = [];
  for (const t of VTENSES) for (let i = 0; i < 5; i++) all.push({ tense: t, idx: i });
  return all;
}
function verbCellTotal(inf) { return verbCells(inf).length; }
function verbLearnedCells(inf) { return verbCells(inf).filter(c => vCellStreak(inf, c.tense, c.idx) >= 3).length; }
function verbIsMastered(inf) { const tot = verbCellTotal(inf); return tot > 0 && verbLearnedCells(inf) >= Math.ceil(tot * 0.9); }
function verbPool() {
  if (vtState().mode === 'lessons') { const enc = encounteredVerbCells(); return VLIST().filter(v => enc[v.inf] && enc[v.inf].size > 0); }
  return VLIST();
}
function verbMasteredList() { return verbPool().filter(v => verbIsMastered(v.inf)).map(v => v.inf); }
function refillActive() {
  const s = vtState();
  const pool = verbPool().map(v => v.inf).filter(inf => !verbIsMastered(inf));
  s.active = s.active.filter(inf => pool.includes(inf));
  for (const inf of pool) { if (s.active.length >= 5) break; if (!s.active.includes(inf)) s.active.push(inf); }
  return s.active;
}
function verbGrade(inf, tense, idx, ok) {
  const wasDone = verbIsMastered(inf);
  const k = vCellKey(inf, tense, idx);
  const c = vtState().cells[k] || (vtState().cells[k] = { streak: 0 });
  c.streak = ok ? c.streak + 1 : 0;
  markActivity();
  if (verbIsMastered(inf)) { vtState().active = vtState().active.filter(x => x !== inf); }
  if (!wasDone && verbIsMastered(inf)) { track('verb_mastered', { verb: inf }); return true; }
  return false;
}
function buildVerbCard() {
  const active = refillActive();
  if (!active.length) return null;
  const cand = active.filter(inf => verbCells(inf).some(c => vCellStreak(inf, c.tense, c.idx) < 3));
  const pickFrom = cand.length ? cand : active;
  const inf = pickFrom[Math.floor(Math.random() * pickFrom.length)];
  const open = verbCells(inf).filter(c => vCellStreak(inf, c.tense, c.idx) < 3);
  const cell = (open.length ? open : verbCells(inf))[Math.floor(Math.random() * (open.length || verbCells(inf).length))];
  if (!cell) return null;
  const correct = conjugate(inf, cell.tense, cell.idx);
  // дистракторы — другие формы того же глагола (берём из всех 20, чтобы было из чего выбрать)
  const all = [];
  for (const t of VTENSES) for (let i = 0; i < 5; i++) all.push(conjugate(inf, t, i));
  const pool = shuffle(all.filter(f => f.toLowerCase() !== correct.toLowerCase()));
  const opts = [], seen = new Set([correct.toLowerCase()]);
  for (const f of pool) { if (!seen.has(f.toLowerCase())) { seen.add(f.toLowerCase()); opts.push(f); if (opts.length >= 3) break; } }
  const options = shuffle([correct].concat(opts));
  const row = VLIST().find(v => v.inf === inf);
  return { inf, ru: row ? row.ru : '', tense: cell.tense, idx: cell.idx, correct, options, correctIndex: options.indexOf(correct) };
}

/* ---------------- уроки: прогресс и доступ ---------------- */
function ldata(id) {
  const d = S.lessons[id] || (S.lessons[id] = { theoryRead: false, examBest: 0 });
  if (!Array.isArray(d.hist)) d.hist = [];          // последние 100 ответов: 1/0
  if (!d.nextMode || !MODE_ORDER.includes(d.nextMode)) d.nextMode = 'translate';
  return d;
}
function histStats(id) {
  const h = ldata(id).hist;
  const ok = h.reduce((a, b) => a + b, 0);
  return { total: h.length, ok, bad: h.length - ok };
}
function examReady(id) {
  const st = histStats(id);
  return st.total >= HIST_WINDOW && st.ok >= HIST_PASS;
}
// прогресс-бар допуска как таймлайн последних 100 плиток:
// слева — самые старые ответы, справа — самый свежий. Красная отметка ошибки
// сдвигается влево по мере новых ответов и выпадает из окна через 100 плиток.
function histBarHTML(id) {
  const h = ldata(id).hist;             // [старые … новые]; h[last] — последний ответ
  const pad = HIST_WINDOW - h.length;   // пустые слоты слева, пока окно не заполнено
  const segs = [];
  for (let slot = 0; slot < HIST_WINDOW; slot++) {
    const i = slot - pad;
    const color = i < 0 ? 'var(--sunk)' : (h[i] ? 'var(--success)' : 'var(--error)');
    segs.push(color + ' ' + slot + '% ' + (slot + 1) + '%');
  }
  return '<div class="histbar" style="background:linear-gradient(to right,' + segs.join(',') + ')"></div>';
}
function learnedCount(lesson) { return lesson.phrases.filter(p => S.phrases[p.id] && S.phrases[p.id].learned).length; }
function lessonUnlocked(i) {
  if (i === 0) return true;
  return (S.lessons[LESSONS[i - 1].id] || {}).examBest >= 80;
}
function lessonDone(l) { return (S.lessons[l.id] || {}).examBest >= 80; }
function currentLessonIndex() {
  for (let i = 0; i < LESSONS.length; i++) if (lessonUnlocked(i) && !lessonDone(LESSONS[i])) return i;
  return LESSONS.length - 1;
}
function totalLearned() { return Object.keys(S.phrases).filter(id => ALL_PHRASES[id] && S.phrases[id].learned).length; }

/* ---------------- озвучка (Web Speech) ---------------- */
let VOICES = [];
function refreshVoices() {
  VOICES = (window.speechSynthesis ? speechSynthesis.getVoices() : [])
    .filter(v => v.lang && v.lang.replace('_', '-').toLowerCase().startsWith('pt'));
}
if (window.speechSynthesis) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = () => { refreshVoices(); };
}
function pickVoice() {
  if (!VOICES.length) refreshVoices();
  const chosen = VOICES.find(v => v.voiceURI === S.settings.voiceURI);
  if (chosen) return chosen;
  return VOICES.find(v => v.lang.replace('_', '-').toLowerCase() === 'pt-pt') || VOICES[0] || null;
}
let speakingTimer = null;
function speak(text, slow) {
  if (!window.speechSynthesis) { toast('Озвучка не поддерживается в этом браузере'); return; }
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v ? v.lang : 'pt-PT';
  u.rate = slow ? Math.max(0.5, S.settings.rate - 0.35) : S.settings.rate;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  const el = document.querySelector('.speaker-anim');
  if (el) { el.classList.add('playing'); clearTimeout(speakingTimer); speakingTimer = setTimeout(() => el.classList.remove('playing'), 1200); }
}

/* короткий звук-обратная связь при ответе (Web Audio, без файлов). Верно — мягкий восходящий
   аккорд; неверно — тихий нисходящий тон. Уважает настройку S.settings.sound. */
let audioCtx = null;
function playSound(ok) {
  if (S.settings && S.settings.sound === false) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    // верно: восходящий аккорд D5→A5 (синус); неверно: нисходящий G4→C4 в слышимом диапазоне (треугольник, громче)
    const seq = ok ? [[587.33, 0, 0.2], [880, 0.08, 0.2]] : [[392, 0, 0.26], [261.63, 0.12, 0.28]];
    seq.forEach(([f, dt, peak]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = ok ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.connect(g); g.connect(ctx.destination);
      const s = t0 + dt, dur = ok ? 0.2 : 0.26;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(peak, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      o.start(s); o.stop(s + dur + 0.02);
    });
  } catch (e) {}
}
// «прогрев» аудио на первом касании: создаём/возобновляем контекст в пользовательском жесте,
// чтобы первый звук ответа не проглатывался (политика автозапуска аудио)
function primeAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}
if (typeof window !== 'undefined') window.addEventListener('pointerdown', primeAudio, { once: true, capture: true });

/* ---------------- распознавание речи ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let rec = null;
function normWords(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.!?…,«»:;]/g, '').trim().split(/\s+/).filter(Boolean);
}
function startRecognition(onInterim, onDone, onErr) {
  rec = new SR();
  rec.lang = 'pt-PT';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    onInterim((finalText + interim).trim());
  };
  rec.onerror = (e) => onErr(e.error);
  rec.onend = () => onDone(finalText.trim());
  rec.start();
}
function stopRecognition() { if (rec) { try { rec.stop(); } catch (e) {} } }

/* ---------------- утилиты ---------------- */
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function tiles(pt) { return pt.replace(/[.!?…,«»:;]/g, '').trim().split(/\s+/).filter(Boolean); }
let toastTimer = null;
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2400);
}

/* ---------------- SVG-иконки ---------------- */
const I = {
  home: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.5V20h14V9.5"/></svg>',
  review: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9a8 8 0 0 1 13-3l2.5 2.2"/><path d="M20 4.5V8h-3.5"/><path d="M20 15a8 8 0 0 1-13 3l-2.5-2.2"/><path d="M4 19.5V16h3.5"/></svg>',
  person: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7"/></svg>',
  lock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  speaker: (cls) => '<svg class="' + (cls || '') + '" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 9a4 4 0 0 1 0 6"/></svg>',
  speakerBig: '<svg class="speaker-anim" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19.5 6a9 9 0 0 1 0 12"/></svg>',
  mic: (sz) => '<svg width="' + (sz || 34) + '" height="' + (sz || 34) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>',
  flame: '<svg width="15" height="15" viewBox="0 0 24 24" fill="var(--warning)"><path d="M12 2c1.2 3.4-1.8 4.6-1.8 7.6a3.8 3.8 0 0 0 7.6 0c0-1.4-.7-2.6-1.4-3.4.4 2.4-1.4 3.4-2 1.6C12.8 6 12 4 12 2Z"/><path d="M9.2 12.5c-.6 2.2.8 4.2 2.8 4.2s3.2-1.6 2.8-3.6c-.7 1.3-1.7 1.1-1.8-.2-.6.9-3.2.6-3.8-.4Z" fill="var(--accent)"/></svg>',
  book: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v15H5.5C4.7 19 4 18.3 4 17.5z"/><path d="M20 5.5C20 4.7 19.3 4 18.5 4H12v15h6.5c.8 0 1.5-.7 1.5-1.5z"/></svg>',
  cards: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="13" height="14" rx="2.5"/><path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h8A2.5 2.5 0 0 1 21 5.5v11a2.5 2.5 0 0 1-2.5 2.5H17"/></svg>',
  medal: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5"/><path d="M9 13l-2 8 5-3 5 3-2-8"/></svg>',
  shield: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
};

/* ---------------- навигация и сессия ---------------- */
let V = { name: 'home', tab: 'home' };   // текущий экран
let sess = null;                          // активная сессия практики/экзамена
let wsess = null;                         // активная сессия режима «1000 слов»
let vsess = null;                         // активная сессия тренажёра форм глаголов

function go(name, extra) { V = Object.assign({ name, tab: V.tab }, extra || {}); track('screen', { name }); render(); }
function goTab(tab) { V = { name: tab, tab }; sess = null; wsess = null; vsess = null; track('screen', { name: tab }); render(); window.scrollTo(0, 0); }

function startSession(type, lessonId) {
  const lesson = LESSONS.find(l => l.id === lessonId);
  let queue, mode;
  if (type === 'exam') {
    queue = shuffle(lesson.phrases).slice(0, Math.min(lesson.exam.count, lesson.phrases.length));
    mode = 'builder';
  } else if (type === 'review') {
    queue = shuffle(dueIds()).slice(0, 20).map(id => ALL_PHRASES[id].p);
    mode = S.settings.defaultMode;
  } else if (type === 'words') {
    queue = shuffle(lesson.vocab || []).slice(0, 12);
    mode = 'translate';
  } else {
    mode = 'builder';   // практика всегда открывается в режиме «Плитки»; другой режим можно выбрать в сессии
    queue = buildPracticeQueue(lesson, mode);
  }
  sess = {
    type, lessonId, queue, i: 0, results: [], mode,
    phase: 'q', builder: null, speakState: 'idle', recognized: '', micError: '',
  };
  track('start_' + type, { lesson: lessonId || 0, mode });
  initCard();
  go('session');
}
function buildPracticeQueue(lesson, mode) {
  // Плитки — бесконечная сессия: вся колода урока, по кругу (см. answer)
  if (mode === 'builder') {
    // RU: взвешенная колода — фразы, где пользователь чаще ошибается, встречаются чаще
    if (APP_LANG === 'ru') return weightedBuilderDeck(lesson);
    return shuffle(lesson.phrases);
  }
  const fresh = lesson.phrases.filter(p => !(S.phrases[p.id] && S.phrases[p.id].learned));
  const old = lesson.phrases.filter(p => S.phrases[p.id] && S.phrases[p.id].learned);
  return shuffle(fresh).concat(shuffle(old)).slice(0, 10);
}
// взвешенная колода плиток: каждой фразе 1..4 копии в зависимости от перевеса ошибок
function weightedBuilderDeck(lesson) {
  const deck = [];
  for (const p of lesson.phrases) {
    const st = S.phrases[p.id] || {};
    const extra = Math.max(0, Math.min(3, (st.wrong || 0) - (st.right || 0)));
    for (let k = 0; k <= extra; k++) deck.push(p);
  }
  return shuffle(deck);
}
function isEndless() { return sess && sess.type === 'practice' && sess.mode === 'builder'; }
function cur() { return sess.queue[sess.i]; }
// пул лишних слов: свои дистракторы + слова из других фраз того же урока,
// кроме слов правильного ответа
function distractorPool(p) {
  const correct = new Set(tiles(p.pt).map(w => w.toLowerCase()));
  const pool = [], seen = new Set();
  const add = w => { const lw = w.toLowerCase(); if (!correct.has(lw) && !seen.has(lw)) { seen.add(lw); pool.push(w); } };
  (p.distractors || []).forEach(add);
  const lid = ALL_PHRASES[p.id] && ALL_PHRASES[p.id].lessonId;
  const lesson = LESSONS.find(l => l.id === lid);
  if (lesson) for (const ph of shuffle(lesson.phrases.filter(x => x.id !== p.id))) {
    tiles(ph.pt).forEach(add);
    if (pool.length >= 10) break;
  }
  return pool;
}
function initCard() {
  sess.phase = 'q'; sess.speakState = 'idle'; sess.recognized = ''; sess.micError = ''; sess.autoSpoke = false;
  const p = cur();
  const words = tiles(p.pt).map((w, i) => ({ id: 'w' + i, w }));
  const n = Math.floor(Math.random() * 4);               // лишних слов: 0..3 (случайно)
  const dis = shuffle(distractorPool(p)).slice(0, n).map((w, i) => ({ id: 'd' + i, w }));
  sess.builder = { slot: [], bank: shuffle(words.concat(dis)), words: tiles(p.pt) };
}
function answer(ok) {
  const item = cur();
  grade(item.id, ok);
  // история допуска: считаются ТОЛЬКО плитки в практике урока (не экзамен, не повторение)
  if (isEndless() && ALL_PHRASES[item.id]) {
    const lh = ldata(ALL_PHRASES[item.id].lessonId).hist;
    lh.push(ok ? 1 : 0);
    if (lh.length > HIST_WINDOW) lh.shift();
    save();
    if (examReady(sess.lessonId) && !sess.readyToasted) {
      sess.readyToasted = true;
      track('admission_unlocked', { lesson: sess.lessonId });
      toast('Допуск к экзамену открыт! 🎉');
    }
  }
  sess.results.push({ phrase: item, ok });
  // повтор при ошибке — ТОЛЬКО в режиме «Плитки» (бесконечная практика); в остальных и в экзамене нет
  if (!ok && isEndless()) { initCard(); render(); return; }
  if (sess.i < sess.queue.length - 1) { sess.i++; initCard(); render(); }
  else if (isEndless()) { sess.queue = shuffle(sess.queue); sess.i = 0; initCard(); render(); } // по кругу
  else finishSession();
}
function finishSession() {
  const ok = sess.results.filter(r => r.ok).length, tot = sess.results.length;
  if (sess.type === 'exam') {
    const pct = Math.round(ok / tot * 100);
    const ld = ldata(sess.lessonId);
    ld.examBest = Math.max(ld.examBest || 0, pct);
    save();
    track('exam_done', { lesson: sess.lessonId, pct, pass: pct >= 80 });
    go('examResult', { pct });
  } else {
    track('session_done', { lesson: sess.lessonId || 0, type: sess.type, mode: sess.mode, correct: ok, total: tot });
    go('sessionResult');
  }
}

/* ---------------- рендер ---------------- */
const app = document.getElementById('app');
function applyTheme() {
  const sys = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = S.theme === 'dark' || (S.theme === 'system' && sys);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); });

function render() {
  hideGloss();
  applyTheme();
  let html = '';
  if (!S.onboarded) html = vOnboarding();
  else switch (V.name) {
    case 'home': html = vHome(); break;
    case 'review': html = vReview(); break;
    case 'profile': html = vProfile(); break;
    case 'lesson': html = vLesson(); break;
    case 'theory': html = vTheory(); break;
    case 'session': html = vSession(); break;
    case 'sessionResult': html = vSessionResult(); break;
    case 'examResult': html = vExamResult(); break;
    case 'verbmap': html = vVerbmap(); break;
    case 'w1kHome': html = vW1kHome(); break;
    case 'w1kSession': html = vW1kSession(); break;
    case 'verbHome': html = vVerbHome(); break;
    case 'verbSession': html = vVerbSession(); break;
    case 'verbList': html = vVerbList(); break;
    case 'verbForms': html = vVerbForms(); break;
    case 'account': html = vAccount(); break;
    default: html = vHome();
  }
  const showTab = S.onboarded && ['home', 'review', 'profile'].includes(V.name);
  app.innerHTML = html + (showTab ? vTabbar() : '');
  // режим «Аудио»: новая карточка-вопрос автоматически озвучивается (один раз)
  if (sess && V.name === 'session' && sess.phase === 'q' && !sess.autoSpoke) {
    const m = sess.type === 'exam' ? 'builder' : sess.mode;
    if (m === 'audio') { sess.autoSpoke = true; speak(cur().pt); }
  }
}

function vTabbar() {
  const t = (id, icon, label) =>
    `<button class="${V.tab === id ? 'on' : ''}" onclick="A.goTab('${id}')">${icon}<span>${label}</span></button>`;
  return `<nav class="tabbar">${t('home', I.home, 'Дом')}${t('review', I.review, 'Повторение')}${t('profile', I.person, 'Профиль')}</nav>`;
}

/* ---------- онбординг ---------- */
let onbStep = 0;
function vOnboarding() {
  const dots = [0, 1, 2].map(i =>
    `<div style="width:8px;height:8px;border-radius:99px;background:${i === onbStep ? 'var(--accent)' : 'var(--border)'}"></div>`).join('');
  let body = '';
  if (onbStep === 0) body = `
    <div class="serif" style="font-size:38px;font-weight:600;color:var(--accent);margin-bottom:16px">Falar</div>
    <div class="serif" style="font-size:26px;font-weight:500;line-height:1.25;margin-bottom:14px">Европейский португальский — с первого урока вслух</div>
    <div class="sub" style="font-size:16px">Метод Петрова: доводим базовые структуры до автоматизма, а не зубрим списки слов.</div>`;
  if (onbStep === 1) body = `
    <div class="serif" style="font-size:25px;font-weight:600;margin-bottom:26px">Как это работает</div>
    ${[['Структуры до автоматизма', '+ / − / ? в трёх временах'], ['Говорим вслух', 'Перевод, аудио, конструктор, произношение'], ['5 минут в день', 'Короткие сессии и умные повторения']]
      .map(([t, s]) => `<div class="row" style="margin-bottom:18px;text-align:left">
        <div style="width:48px;height:48px;border-radius:14px;background:var(--accent-sunk);display:flex;align-items:center;justify-content:center;color:var(--accent);flex:none">${I.check}</div>
        <div class="grow"><div style="font-weight:500;font-size:16px">${t}</div><div class="hint" style="margin-top:2px">${s}</div></div></div>`).join('')}`;
  if (onbStep === 2) body = `
    <div class="serif" style="font-size:25px;font-weight:600;margin-bottom:10px">Цель на день</div>
    <div class="sub" style="margin-bottom:24px">Сколько карточек в день вам комфортно? Можно изменить потом.</div>
    <div class="seg" style="width:100%">
      ${[10, 20, 30].map(n => `<button class="${S.dayGoal === n ? 'on' : ''}" onclick="A.setGoal(${n})">${n}</button>`).join('')}
    </div>`;
  return `<div class="screen no-tab" style="display:flex;flex-direction:column">
    <div style="display:flex;justify-content:flex-end"><button class="btn-text btn" style="width:auto;height:auto;padding:8px" onclick="A.finishOnb()">Пропустить</button></div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;text-align:center;padding:0 14px">${body}</div>
    <div style="display:flex;justify-content:center;gap:8px;margin:18px 0">${dots}</div>
    <button class="btn btn-primary" onclick="A.onbNext()">${onbStep < 2 ? 'Далее' : 'Начать с Урока 1'}</button>
  </div>`;
}

/* показывать ли напоминание «защитить прогресс»: есть аккаунт, он не защищён,
   уже накоплен заметный прогресс и напоминание не закрыто */
function shouldNudgeSecure() {
  return !!AUTH.token && !AUTH.secured && !S.nudgeSecureDismissed && progressScore(S) >= 25;
}

/* ---------- Дом ---------- */
function vHome() {
  touchDay();
  const due = dueIds().length;
  const ci = currentLessonIndex();
  const cl = LESSONS[ci];
  const pct = Math.min(100, Math.round((S.day.done / S.dayGoal) * 100));
  const Cc = 2 * Math.PI * 30;
  const left = Math.max(0, S.dayGoal - S.day.done);

  const contTitle = due > 0 ? `Повторить ${due} карточек` : `Урок ${cl.number} · Практика`;
  const contSub = due > 0 ? 'Интервальные повторения ждут' : esc(cl.title);
  const contAction = due > 0 ? `A.startReview()` : `A.startPractice(${cl.id})`;

  const list = LESSONS.map((l, i) => {
    const unlocked = lessonUnlocked(i);
    const done = lessonDone(l);
    const current = i === ci && unlocked && !done;
    const lc = learnedCount(l);
    const statusIcon = done
      ? `<div class="status-dot" style="background:var(--success-sunk);color:var(--success)">${I.check}</div>`
      : current
        ? `<div class="status-dot" style="background:var(--accent);color:#fff">${I.chev}</div>`
        : !unlocked ? `<span style="color:var(--lock)">${I.lock}</span>` : `<span style="color:var(--t3)">${I.chev}</span>`;
    const bar = (lc > 0 || current) && unlocked ? `
      <div class="miniprog"><div class="bar"><div style="width:${Math.round(lc / l.phrases.length * 100)}%"></div></div><span class="mono">${lc}/${l.phrases.length}</span></div>` : '';
    return `<div class="card lesson-card tappable ${current ? 'current' : ''} ${!unlocked ? 'locked' : ''}"
      onclick="${unlocked ? `A.openLesson(${l.id})` : `A.lockedTap()`}">
      <div class="lesson-num mono">${String(l.number).padStart(2, '0')}</div>
      <div class="grow"><h2>${esc(l.title)}</h2><div class="hint" style="margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.topic)}</div>${bar}</div>
      ${statusIcon}</div>`;
  }).join('');

  return `<div class="screen">
    <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:20px">
      <div><h1>Olá!</h1><div class="sub">Продолжим португальский</div></div>
      <div class="pill pill-accent" style="height:34px">${I.flame}<b class="mono" style="color:var(--t1)">${S.streak}</b></div>
    </div>

    ${shouldNudgeSecure() ? `
    <div class="card row" style="background:var(--accent-sunk);border:1px solid var(--accent);margin-bottom:14px;padding:12px 14px;gap:10px">
      <div style="color:var(--accent);flex:none">${I.shield}</div>
      <div class="grow"><div style="font-weight:600;font-size:14.5px">Сохраните прогресс</div><div class="hint" style="margin-top:2px;line-height:1.4">Получите код восстановления — иначе прогресс пропадёт при очистке кеша.</div></div>
      <button class="btn" style="width:auto;height:36px;padding:0 14px;border-radius:99px;background:var(--accent);color:#fff;font-size:13px;font-weight:600;flex:none" onclick="A.openAccount()">Защитить</button>
      <button class="icon-btn" style="background:none;width:26px;height:26px;flex:none;color:var(--t3)" onclick="A.dismissNudge()">${I.close}<span class="sr-only">Закрыть</span></button>
    </div>` : ''}

    <div class="card row" style="margin-bottom:14px">
      <div class="ring-wrap" style="width:68px;height:68px;flex:none">
        <svg width="68" height="68" viewBox="0 0 68 68">
          <circle cx="34" cy="34" r="30" fill="none" stroke="var(--sunk)" stroke-width="7"/>
          <circle cx="34" cy="34" r="30" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round"
            stroke-dasharray="${pct / 100 * Cc} ${Cc}" transform="rotate(-90 34 34)"/>
        </svg>
        <div class="ring-center"><b class="mono" style="font-size:17px">${S.day.done}</b><span style="font-size:10px;color:var(--t3)">/${S.dayGoal}</span></div>
      </div>
      <div class="grow"><h2>Цель дня</h2>
        <div class="sub">${left > 0 ? `Осталось <b style="color:var(--accent)">${left} карточек</b> на сегодня` : 'Цель выполнена! 🎉'}</div></div>
    </div>

    <div class="card tappable" style="background:var(--accent);border:none;margin-bottom:24px" onclick="${contAction}">
      <div class="row">
        <div class="grow">
          <div style="font-size:12px;color:rgba(255,255,255,.8);letter-spacing:.04em;text-transform:uppercase;font-weight:600">Продолжить</div>
          <div class="serif" style="font-size:20px;font-weight:600;color:#fff;margin-top:4px">${contTitle}</div>
          <div style="font-size:13px;color:rgba(255,255,255,.85);margin-top:3px">${contSub}</div>
        </div>
        <div style="width:44px;height:44px;border-radius:99px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;color:#fff;flex:none">${I.chev}</div>
      </div>
    </div>

    <div class="serif" style="font-size:18px;font-weight:500;margin-bottom:12px">Программа · ${LESSONS.length} уроков</div>
    <div style="display:flex;flex-direction:column;gap:10px">${list}</div>
    ${(w1kHas() || verbsHas()) ? `
    <div class="serif" style="font-size:18px;font-weight:500;margin:24px 0 12px">Тренажёры</div>
    <div style="display:flex;flex-direction:column;gap:10px">
    ${w1kHas() ? `
    <div class="card lesson-card tappable" onclick="A.openW1k()">
      <div style="width:44px;height:44px;border-radius:13px;background:var(--accent-sunk);display:flex;align-items:center;justify-content:center;color:var(--accent);flex:none;font-weight:700;font-family:Lora,serif">PT</div>
      <div class="grow"><h2>Слова учебника</h2><div class="hint" style="margin-top:2px">Юниты 1–12 · PT ⇄ RU · изучено ${w1kLearnedCount()}/${W1K().length}</div></div>
      <span style="color:var(--t3)">${I.chev}</span>
    </div>` : ''}
    ${verbsHas() ? `
    <div class="card lesson-card tappable" onclick="A.openVerbs()">
      <div style="width:44px;height:44px;border-radius:13px;background:var(--accent-sunk);display:flex;align-items:center;justify-content:center;color:var(--accent);flex:none;font-weight:700;font-family:Lora,serif">V</div>
      <div class="grow"><h2>Формы глаголов</h2><div class="hint" style="margin-top:2px">Спряжение · 4 времени × 5 лиц · освоено ${verbMasteredList().length}</div></div>
      <span style="color:var(--t3)">${I.chev}</span>
    </div>` : ''}
    </div>` : ''}
  </div>`;
}

/* ---------- Урок ---------- */
function vLesson() {
  const l = LESSONS.find(x => x.id === V.lessonId);
  const ld = ldata(l.id);
  const lc = learnedCount(l);
  const frac = lc / l.phrases.length;
  const examOpen = examReady(l.id);
  const hs = histStats(l.id);
  const tagPills = (l.tags || []).map(t => `<span class="pill pill-sunk">${esc(t)}</span>`).join(' ');
  return `<div class="screen no-tab">
    <button class="icon-btn" style="margin-bottom:16px" onclick="A.goTab('home')">${I.back}<span class="sr-only">Назад</span></button>
    <div style="display:flex;gap:8px;margin-bottom:10px"><span class="pill pill-accent">Урок ${String(l.number).padStart(2, '0')}</span>${tagPills}</div>
    <h1>${esc(l.title)}</h1>
    <div class="sub" style="margin-bottom:24px">${esc(l.topic)}</div>
    <div style="display:flex;flex-direction:column;gap:12px">

      <div class="card row tappable" onclick="A.openTheory(${l.id})">
        <div style="width:48px;height:48px;border-radius:14px;background:var(--accent-sunk);display:flex;align-items:center;justify-content:center;color:var(--accent);flex:none">${I.book}</div>
        <div class="grow"><h2>Теория</h2><div class="hint" style="margin-top:2px">${ld.theoryRead ? '✓ Прочитано' : 'Таблица глагола · 3 мин'}</div></div>
        <span style="color:var(--t3)">${I.chev}</span>
      </div>

      ${(l.vocab && l.vocab.length) ? `
      <div class="card row tappable" onclick="A.startWords(${l.id})">
        <div style="width:48px;height:48px;border-radius:14px;background:var(--accent-sunk);display:flex;align-items:center;justify-content:center;color:var(--accent);flex:none">${I.speakerBig.replace('width="40" height="40"', 'width="24" height="24"')}</div>
        <div class="grow"><h2>Слова</h2><div class="hint" style="margin-top:2px">Словарь урока · ${l.vocab.length} слов · в обе стороны, на слух, вслух</div></div>
        <span style="color:var(--t3)">${I.chev}</span>
      </div>` : ''}

      <div class="card row tappable" style="border:1.5px solid var(--accent)" onclick="A.startPractice(${l.id})">
        <div style="width:48px;height:48px;border-radius:14px;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;flex:none">${I.cards}</div>
        <div class="grow"><h2>Практика</h2>
          <div class="hint" style="margin-top:2px">Собери фразу из плиток · режим можно сменить в сессии</div>
          <div class="miniprog"><div class="bar"><div style="width:${Math.round(frac * 100)}%"></div></div><span class="mono">${lc}/${l.phrases.length}</span></div>
        </div>
      </div>

      <div class="card ${examOpen ? 'tappable' : ''}" style="${examOpen ? '' : 'opacity:.75'}"
        onclick="${examOpen ? `A.startExam(${l.id})` : `A.examLockedTap()`}">
        <div class="row">
          <div style="width:48px;height:48px;border-radius:14px;background:${examOpen ? 'var(--accent-sunk)' : 'var(--sunk)'};display:flex;align-items:center;justify-content:center;color:${examOpen ? 'var(--accent)' : 'var(--lock)'};flex:none">${I.medal}</div>
          <div class="grow"><h2>Экзамен</h2><div class="hint" style="margin-top:2px">
            ${ld.examBest > 0 ? `Лучший результат: <b style="color:${ld.examBest >= 80 ? 'var(--success)' : 'var(--accent)'}">${ld.examBest}%</b> · ` : ''}
            ${examOpen ? `${l.exam.count} заданий · строгий режим` : `Допуск: ${HIST_PASS} верных из ${HIST_WINDOW} последних плиток`}</div></div>
          ${examOpen ? `<span style="color:var(--t3)">${I.chev}</span>` : `<span style="color:var(--lock)">${I.lock}</span>`}
        </div>
        <div style="margin-top:12px">
          ${histBarHTML(l.id)}
          <div class="hint mono" style="margin-top:5px"><span style="color:var(--success)">✓ ${hs.ok}</span> · <span style="color:var(--error)">✗ ${hs.bad}</span>${hs.total < HIST_WINDOW ? ` · набрано ${hs.total}/${HIST_WINDOW}` : (hs.ok >= HIST_PASS ? ' · допуск открыт' : ` · нужно ≥${HIST_PASS} верных`)}</div>
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------- учебные таблицы урока (RU) ----------
   Типы: compare (2 формы рядом), paradigm (спряжение по лицам),
   contractions (слияния предлог×артикль), list (список pt/ru). Ячейки PT кликабельны. */
function speakBtn(text, cls) {
  const t = esc(text);
  return `<button class="${cls || 'tcell'}" onclick="A.cellTap(this,'${t.replace(/'/g, "\\'")}')">${t}</button>`;
}
function tableHTML(tb) {
  if (tb.type === 'compare') return compareHTML(tb);
  if (tb.type === 'paradigm') return paradigmHTML(tb);
  if (tb.type === 'contractions') return contractionsHTML(tb);
  if (tb.type === 'list') return listHTML(tb);
  return '';
}
function tableCard(tb) {
  return `<div class="card tbl-card">
    ${tb.title ? `<div class="tbl-title">${esc(tb.title)}</div>` : ''}
    ${tableHTML(tb)}
    ${tb.note ? `<div class="hint tbl-note">💡 ${esc(tb.note)}</div>` : ''}
  </div>`;
}
function compareHTML(tb) {
  // rows: [label, ptA, ptB]; cols: [headA, headB]
  return `<div class="tbl tbl-compare">
    <div class="tcap"></div><div class="thd">${esc(tb.cols[0])}</div><div class="thd">${esc(tb.cols[1])}</div>
    ${tb.rows.map(r => `<div class="tlbl">${esc(r[0])}</div>${speakBtn(r[1])}${speakBtn(r[2])}`).join('')}
  </div>`;
}
function paradigmHTML(tb) {
  // forms: [[person, form], ...]
  return `<div class="tbl tbl-paradigm">
    ${tb.forms.map(r => `<div class="tlbl">${esc(r[0])}</div>${speakBtn(r[1])}`).join('')}
  </div>`;
}
function contractionsHTML(tb) {
  // rows: prepositions; cols: articles; cells[i][j]
  return `<div class="tbl tbl-contr" style="grid-template-columns:auto repeat(${tb.cols.length},1fr)">
    <div class="tcap"></div>${tb.cols.map(c => `<div class="thd">${esc(c)}</div>`).join('')}
    ${tb.rows.map((rp, i) => `<div class="tlbl">${esc(rp)}</div>${tb.cells[i].map(c => speakBtn(c)).join('')}`).join('')}
  </div>`;
}
function listHTML(tb) {
  const n = tb.cols || 2;
  return `<div class="tbl tbl-list" style="grid-template-columns:repeat(${n},1fr)">
    ${tb.items.map(it => `<div class="litem">${speakBtn(it.pt, 'tcell litem-pt')}<span class="litem-ru">${esc(it.ru)}</span></div>`).join('')}
  </div>`;
}

/* ---------- Теория ---------- */
function vTheory() {
  const l = LESSONS.find(x => x.id === V.lessonId);
  const vt = l.verbTable;
  const cols = ['Настоящее', 'Прошедшее', 'Будущее'];
  const rows = [
    { sign: '+', key: 'affirm' }, { sign: '–', key: 'negate' }, { sign: '?', key: 'question' },
  ];
  const blocks = (l.theory.blocks || []).map(b =>
    b.type === 'note'
      ? `<div class="note-block">💡 ${esc(b.content)}</div>`
      : `<p style="font-size:15.5px;line-height:1.55;color:var(--t1);margin:12px 0">${esc(b.content)}</p>`).join('');
  const grid = `
    <div class="vtable">
      <div></div>${cols.map(c => `<div class="head">${c}</div>`).join('')}
      ${rows.map(r => `
        <div class="sign">${r.sign}</div>
        ${['present', 'past', 'future'].map(t => {
          const txt = vt.schema[t][r.key];
          return `<button class="vcell" onclick="A.cellTap(this,'${esc(txt).replace(/'/g, "\\'")}')">${esc(txt)}</button>`;
        }).join('')}`).join('')}
    </div>`;
  const pf = vt.presentFull ? `
    <div class="hint" style="margin:18px 0 8px">Настоящее время по лицам — нажми и послушай:</div>
    <div class="chips">${Object.entries({ eu: 'eu', tu: 'tu', ele: 'ele/ela', nos: 'nós', eles: 'eles' })
      .map(([k, label]) => vt.presentFull[k] ? `<button class="chip" onclick="A.say('${esc(vt.presentFull[k])}')">${label} <b>${esc(vt.presentFull[k])}</b></button>` : '').join('')}</div>` : '';
  // RU: тематические таблицы урока (ниже базовой схемы глагола)
  const tables = (APP_LANG === 'ru' && Array.isArray(l.tables)) ? l.tables.map(tableCard).join('') : '';
  return `<div class="screen no-tab" style="display:flex;flex-direction:column;padding-bottom:0">
    <button class="icon-btn" style="margin-bottom:14px" onclick="A.openLesson(${l.id})">${I.back}<span class="sr-only">Назад</span></button>
    <div style="flex:1;overflow-y:auto;padding-bottom:16px">
      <h1 style="font-size:26px">${esc(l.title)}</h1>
      <p style="font-size:16px;line-height:1.55;color:var(--t2);margin:10px 0 18px">${esc(l.theory.intro)}</p>
      <div class="card" style="padding:14px">
        <div class="center serif" style="font-size:19px;color:var(--accent);font-weight:500;margin-bottom:12px">${esc(vt.verb)} — ${esc(vt.translation)}</div>
        ${grid}
        <div class="hint center" style="margin-top:12px">${I.speaker()} Тап по ячейке — озвучка</div>
      </div>
      ${pf}
      ${blocks}
      ${tables}
    </div>
    <div style="padding:14px 0 28px;background:linear-gradient(to top,var(--canvas) 65%,transparent)">
      <button class="btn btn-primary" onclick="A.startPractice(${l.id})">К практике</button>
    </div>
  </div>`;
}

/* ---------- плитки: рендер зон, перетаскивание, подсказка-перевод ---------- */
function builderSlotHTML() {
  return sess.builder.slot.map((t, i) =>
    `<button class="tile in-slot" onpointerdown="A.tileDown(event,'slot',${i})">${esc(t.w)}</button>`).join('');
}
function builderBankHTML() {
  // выбранные плитки остаются «призраками» на своих местах — банк не перестраивается
  return sess.builder.bank.map((t, i) => t.used
    ? `<button class="tile ghost" disabled>${esc(t.w)}</button>`
    : `<button class="tile" onpointerdown="A.tileDown(event,'bank',${i})">${esc(t.w)}</button>`).join('');
}

/* перетаскивание плиток: тап = быстрый перенос (как раньше), перетаскивание = вставка в позицию */
let drag = null;
function removeCaret() { const c = document.getElementById('ins-caret'); if (c) c.remove(); }
function tileDragMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 7) return;
    drag.moved = true;
    const r = drag.el.getBoundingClientRect();
    const c = drag.el.cloneNode(true);
    c.className = 'tile drag-clone';
    c.style.width = r.width + 'px'; c.style.left = r.left + 'px'; c.style.top = r.top + 'px';
    document.body.appendChild(c);
    drag.clone = c; drag.offX = drag.x0 - r.left; drag.offY = drag.y0 - r.top;
    drag.el.classList.add('dragging');
  }
  drag.clone.style.left = (e.clientX - drag.offX) + 'px';
  drag.clone.style.top = (e.clientY - drag.offY) + 'px';
  // куда вставить: ищем позицию в слоте по координате
  const slotEl = document.getElementById('bld-slot');
  removeCaret();
  drag.insIndex = null;
  if (!slotEl) return;
  const r = slotEl.getBoundingClientRect();
  if (e.clientX < r.left - 24 || e.clientX > r.right + 24 || e.clientY < r.top - 24 || e.clientY > r.bottom + 40) return;
  const tilesEls = [...slotEl.querySelectorAll('.tile')].filter(el => el !== drag.el);
  let idx = tilesEls.length;
  for (let i = 0; i < tilesEls.length; i++) {
    const tr = tilesEls[i].getBoundingClientRect();
    if (e.clientY < tr.bottom && e.clientX < tr.left + tr.width / 2) { idx = i; break; }
  }
  drag.insIndex = idx;
  const caret = document.createElement('div'); caret.className = 'ins-caret'; caret.id = 'ins-caret';
  if (idx >= tilesEls.length) slotEl.appendChild(caret); else slotEl.insertBefore(caret, tilesEls[idx]);
}
function tileDragUp() {
  document.removeEventListener('pointermove', tileDragMove);
  document.removeEventListener('pointerup', tileDragUp);
  document.removeEventListener('pointercancel', tileDragUp);
  if (!drag) return;
  const d = drag; drag = null;
  if (d.clone) d.clone.remove();
  removeCaret();
  if (d.el) d.el.classList.remove('dragging');
  if (!d.moved) { d.kind === 'bank' ? A.tapBank(d.index) : A.tapSlot(d.index); return; }  // тап
  if (d.kind === 'bank') {
    if (d.insIndex == null) return;                 // бросили мимо слота — ничего
    d.tile.used = true;
    sess.builder.slot.splice(d.insIndex, 0, d.tile);
  } else {
    sess.builder.slot.splice(d.index, 1);           // вынимаем плитку из слота
    if (d.insIndex == null) d.tile.used = false;     // бросили вне слота — вернётся в банк
    else sess.builder.slot.splice(d.insIndex, 0, d.tile);
  }
  renderBuilderZones();
}
// точечное обновление только зон плиток — без перерисовки всего экрана (быстрый отклик на тап)
function renderBuilderZones() {
  const slot = document.getElementById('bld-slot');
  const bank = document.getElementById('bld-bank');
  const chk = document.getElementById('bld-check');
  if (slot) slot.innerHTML = builderSlotHTML();
  if (bank) bank.innerHTML = builderBankHTML();
  if (chk) chk.disabled = sess.builder.slot.length === 0;
}
// фраза-задание: каждое русское слово — кликабельно (показывает перевод по позиции)
function glossPromptHTML(ru) {
  let i = -1;
  return esc(ru).replace(/([A-Za-zА-Яа-яЁё]+(?:['’‑-][A-Za-zА-Яа-яЁё]+)*)/g,
    (m) => { i++; return `<span class="gword" onclick="A.glossWordIdx(this,${i})">${m}</span>`; });
}
function glossLookup(word) {
  const g = (window.FALAR_CONTENT.glossary) || {};
  const w = word.toLowerCase();
  return g[w] || g[w.replace(/ё/g, 'е')] || '';
}
function hideGloss() {
  const e = document.getElementById('gloss-pop');
  if (e) e.remove();
  document.removeEventListener('pointerdown', glossDocHandler, true);
}
function glossDocHandler(e) {
  const pop = document.getElementById('gloss-pop');
  if (pop && !pop.contains(e.target) && !e.target.classList.contains('gword')) hideGloss();
}
function showGloss(el, pt) {
  hideGloss();
  const pop = document.createElement('div');
  pop.id = 'gloss-pop'; pop.className = 'gloss-pop';
  pop.innerHTML = pt
    ? `<span>${esc(pt)}</span><button class="gloss-spk" onclick="A.sayGloss(event,'${esc(pt).replace(/'/g, "\\'")}')">${I.speaker()}</button>`
    : `<span style="color:var(--t3)">— нет отдельного слова</span>`;
  document.body.appendChild(pop);
  const r = el.getBoundingClientRect();
  let left = r.left + r.width / 2 - pop.offsetWidth / 2;
  left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, left));
  let top = r.top - pop.offsetHeight - 8;
  if (top < 8) top = r.bottom + 8;
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
  setTimeout(() => document.addEventListener('pointerdown', glossDocHandler, true), 0);
}

/* ---------- Сессия (практика/экзамен/повторение) ---------- */
function vSession() {
  const p = cur();
  const endless = isEndless();
  const hs = sess.lessonId ? histStats(sess.lessonId) : null;
  // в бесконечных плитках верхний бар показывает путь к допуску (98), в остальных — прогресс сессии
  const pct = endless ? Math.min(100, Math.round(hs.ok / HIST_PASS * 100)) : Math.round(sess.i / sess.queue.length * 100);
  const counter = endless ? `${sess.results.length} · ∞` : `${sess.i + 1}/${sess.queue.length}`;
  const isExam = sess.type === 'exam';
  const modes = sess.type === 'words' ? WORD_MODES : MODE_ORDER;
  const modeBar = isExam ? `
    <div class="center" style="font-size:12px;color:var(--accent);letter-spacing:.06em;text-transform:uppercase;font-weight:700;padding:8px 0 2px">Экзамен · строгий режим</div>` : `
    <div class="seg" style="margin:10px 0 0">
      ${modes.map(m => `<button class="${sess.mode === m ? 'on' : ''}" onclick="A.setMode('${m}')">${MODE_LABEL[m]}</button>`).join('')}
    </div>`;

  let body = '';
  if (sess.phase === 'q') body = qBody(p);
  else body = aBody(p);

  // прогресс допуска к экзамену: верные/неверные за последние 100 плиток урока
  let histBar = '';
  if (endless) {
    const ready = examReady(sess.lessonId);
    histBar = `<div style="padding:2px 0 14px">
      ${histBarHTML(sess.lessonId)}
      <div class="hint center mono" style="margin-top:6px">Допуск к экзамену: ${HIST_PASS} из ${HIST_WINDOW} плиток · <span style="color:var(--success)">✓ ${hs.ok}</span> · <span style="color:var(--error)">✗ ${hs.bad}</span>${hs.total < HIST_WINDOW ? ` · набрано ${hs.total}/${HIST_WINDOW}` : ''}</div>
      ${ready ? `<button class="btn btn-success" style="height:46px;margin-top:10px" onclick="A.startExam(${sess.lessonId})">${I.check} Допуск открыт — к экзамену</button>` : ''}
    </div>`;
  }

  return `<div class="screen no-tab" style="display:flex;flex-direction:column;padding-bottom:0">
    <div class="row">
      <button class="icon-btn" style="background:none" onclick="A.exitSession()">${I.close}<span class="sr-only">Закрыть</span></button>
      <div class="progressbar"><div style="width:${pct}%"></div></div>
      <span class="hint mono">${counter}</span>
    </div>
    ${modeBar}
    ${body}
    ${histBar}
  </div>`;
}

function qBody(p) {
  const m = sess.type === 'exam' ? 'builder' : sess.mode;
  if (m === 'translate') return `
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:20px 8px">
      <div class="hint" style="margin-bottom:16px">${sess.type === 'words' ? 'Переведите на португальский' : 'Переведите вслух'}</div>
      <div class="phrase-ru">${esc(p.ru)}</div>
    </div>
    <div style="padding:14px 0 30px"><button class="btn btn-primary" onclick="A.reveal()">Показать ответ</button></div>`;

  if (m === 'audio') return `
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:20px 8px">
      <button class="bigbtn" aria-label="Прослушать" style="background:var(--accent-sunk);color:var(--accent);margin-bottom:18px" onclick="A.say('${esc(p.pt).replace(/'/g, "\\'")}')">${I.speakerBig}</button>
      <div style="font-size:16px;color:var(--t2)">Прослушайте и переведите</div>
      <button class="btn btn-text" style="width:auto;height:auto;margin-top:12px;font-size:14px" onclick="A.say('${esc(p.pt).replace(/'/g, "\\'")}',true)">Прослушать медленно</button>
    </div>
    <div style="padding:14px 0 30px"><button class="btn btn-primary" onclick="A.reveal()">Показать ответ</button></div>`;

  if (m === 'reverse') return `
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:20px 8px">
      <div class="hint" style="margin-bottom:16px">Переведите на русский</div>
      <div class="phrase-pt" style="font-size:25px;margin-bottom:14px">${esc(p.pt)}</div>
      <button class="btn btn-text" style="width:auto;height:auto;font-size:14px" onclick="A.say('${esc(p.pt).replace(/'/g, "\\'")}')">${I.speaker()} Слушать</button>
    </div>
    <div style="padding:14px 0 30px"><button class="btn btn-primary" onclick="A.reveal()">Показать ответ</button></div>`;

  if (m === 'builder') {
    const isExam = sess.type === 'exam';
    // в экзамене перевод предложения и слов смотреть нельзя
    const promptHTML = isExam
      ? `<div class="phrase-ru center" style="font-size:20px;margin-bottom:16px">${esc(p.ru)}</div>`
      : `<div class="phrase-ru center" id="bld-prompt" style="font-size:20px;margin-bottom:6px">${glossPromptHTML(p.ru)}</div>
         <div class="hint center" style="margin-bottom:16px">тап по слову — перевод</div>`;
    return `
    <div style="flex:1;display:flex;flex-direction:column;padding:16px 0 0;overflow-y:auto">
      ${promptHTML}
      <div class="slotzone" id="bld-slot">${builderSlotHTML()}</div>
      <div class="bankzone" id="bld-bank">${builderBankHTML()}</div>
    </div>
    <div style="padding:14px 0 30px"><button class="btn btn-primary" id="bld-check" ${sess.builder.slot.length === 0 ? 'disabled' : ''} onclick="A.checkBuilder()">Проверить</button></div>`;
  }

  /* speak */
  if (!SR) return `
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:20px 18px">
      <div style="width:72px;height:72px;border-radius:99px;background:var(--sunk);display:flex;align-items:center;justify-content:center;color:var(--t2);margin-bottom:18px">${I.mic(32)}</div>
      <h2 style="margin-bottom:8px">Распознавание речи недоступно</h2>
      <div class="sub" style="margin-bottom:8px">Этот браузер не поддерживает распознавание. Попробуйте Chrome (Android/ПК) или Safari (iPhone).</div>
    </div>
    <div style="padding:14px 0 30px"><button class="btn btn-secondary" onclick="A.setMode('translate')">Перейти в режим «Перевод»</button></div>`;

  const recording = sess.speakState === 'recording';
  return `
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:20px 8px">
      <div class="phrase-pt" style="font-size:24px;margin-bottom:6px">${esc(p.pt)}</div>
      <button class="btn btn-text" style="width:auto;height:auto;margin-bottom:26px;font-size:14px" onclick="A.say('${esc(p.pt).replace(/'/g, "\\'")}')">${I.speaker()} Слушать эталон</button>
      ${recording ? `
        <div style="position:relative;width:120px;height:120px;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
          <div style="position:absolute;inset:8px;border-radius:99px;background:var(--accent-sunk);animation:ping 1.4s ease-out infinite"></div>
          <div style="position:absolute;inset:8px;border-radius:99px;background:var(--accent-sunk);animation:ping 1.4s ease-out .5s infinite"></div>
          <button class="bigbtn" style="background:var(--accent);position:relative;z-index:2;width:88px;height:88px" onclick="A.stopRec()"><div style="width:26px;height:26px;border-radius:6px;background:#fff"></div></button>
        </div>
        <div style="font-size:17px;color:var(--t1);min-height:24px">${esc(sess.recognized) || '<span style="color:var(--t3)">Говорите…</span>'}</div>` : `
        <button class="bigbtn" aria-label="Записать произношение" style="background:var(--accent);color:#fff;box-shadow:var(--shadow)" onclick="A.startRec()">${I.mic(38)}</button>
        <div class="sub" style="margin-top:14px">Нажмите и произнесите фразу</div>
        ${sess.micError ? `<div class="hint" style="color:var(--error);margin-top:10px">${esc(sess.micError)}</div>` : ''}`}
    </div>
    <div style="padding:14px 0 30px">${recording ? '' : `<button class="btn btn-secondary" onclick="A.skipSpeak()">Пропустить</button>`}</div>`;
}

function aBody(p) {
  const m = sess.type === 'exam' ? 'builder' : sess.mode;
  const ptEsc = esc(p.pt).replace(/'/g, "\\'");

  if (m === 'translate' || m === 'audio' || m === 'reverse') return `
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:20px 8px;animation:reveal .3s ease-out both">
      <div class="hint" style="margin-bottom:14px">${esc(m === 'reverse' ? p.pt : p.ru)}</div>
      <div class="phrase-pt" style="margin-bottom:20px">${esc(m === 'reverse' ? p.ru : p.pt)}</div>
      <div class="row">
        <button class="btn" style="width:auto;height:42px;padding:0 16px;border-radius:99px;background:var(--accent-sunk);color:var(--accent);font-size:14px" onclick="A.say('${ptEsc}')">${I.speaker('speaker-anim')} Слушать</button>
        <button class="btn" style="width:auto;height:42px;padding:0 16px;border-radius:99px;background:var(--sunk);color:var(--t2);font-size:14px" onclick="A.say('${ptEsc}',true)">0.5×</button>
      </div>
    </div>
    <div class="row" style="padding:14px 0 30px;gap:12px">
      <button class="btn btn-secondary" onclick="A.ans(false)"><span style="color:var(--error)">${I.close}</span>Ошибся</button>
      <button class="btn btn-success" onclick="A.ans(true)">${I.check}Знал</button>
    </div>`;

  if (m === 'builder') {
    const userWords = sess.builder.slot.map(t => t.w);
    const ev = evalBuilder(userWords, sess.builder.words);
    const correct = ev.correct;
    const correctCard = `
      <div class="card row" style="background:var(--success-sunk);border:none;margin-top:16px;padding:14px 16px">
        <div class="grow">
          <div style="font-size:12px;color:var(--success);font-weight:600">Правильный вариант</div>
          <div style="font-size:18px;margin-top:2px">${esc(p.pt)}</div>
        </div>
        <button class="icon-btn" aria-label="Прослушать" style="background:var(--surface);width:40px;height:40px;color:var(--success)" onclick="A.say('${ptEsc}')">${I.speaker('speaker-anim')}</button>
      </div>`;
    let view;
    if (correct) {
      const slot = userWords.map(w => `<span class="tile ok">${esc(w)}</span>`).join('');
      view = `<div class="slotzone" style="border-style:solid">${slot}</div>${correctCard}
        <div class="center" style="margin-top:14px;font-weight:600;color:var(--success)">✓ Верно!</div>`;
    } else if (APP_LANG === 'ru') {
      // RU: разбор ошибки — одно предложение с подсветкой + правило
      const diff = diffBuilder(userWords, sess.builder.words);
      const ex = builderExplain(diff, p);
      view = `
        <div class="diff-sentence">${diffSentenceHTML(diff)}</div>
        <div class="diff-legend center">
          <span class="diff-ok">на месте</span> · <span class="diff-missing">пропущено</span> · <span class="diff-extra">лишнее</span>
        </div>
        ${ex ? `<div class="diff-explain">${esc(ex)}</div>` : ''}
        ${correctCard}`;
    } else {
      const slot = sess.builder.slot.map((t, i) =>
        `<span class="tile ${ev.ref[i] === t.w ? 'ok' : 'bad'}">${esc(t.w)}</span>`).join('');
      view = `<div class="slotzone" style="border-style:solid">${slot}</div>${correctCard}
        <div class="center" style="margin-top:14px;font-weight:600;color:var(--error)">Есть ошибки — посмотри подсветку</div>`;
    }
    return `
    <div style="flex:1;display:flex;flex-direction:column;padding:16px 0 0;animation:reveal .3s ease-out both;overflow-y:auto">
      <div class="phrase-ru center" style="font-size:20px;margin-bottom:18px">${esc(p.ru)}</div>
      ${view}
    </div>
    <div style="padding:14px 0 30px"><button class="btn btn-primary" onclick="A.nextBuilder(${correct})">Дальше</button></div>`;
  }

  /* speak answer — местоимение можно опускать, оно не штрафуется */
  const ref = tiles(p.pt);
  const saidNorm = normWords(sess.recognized || '');
  // обязательные слова = всё, кроме опущенных подлежащих-местоимений; считаем по ним
  let required = 0, hit = 0;
  const wordsHtml = ref.map(w => {
    const said = saidNorm.includes(normWord(w));
    if (said) { required++; hit++; return `<span class="word-ok">${esc(w)}</span>`; }
    if (isSubjPron(w)) return `<span class="word-dim">${esc(w)}</span>`;   // опущено — это нормально
    required++; return `<span class="word-bad">${esc(w)}</span>`;
  }).join(' ');
  const pctMatch = Math.round(hit / Math.max(1, required) * 100);
  const Cc = 2 * Math.PI * 42;
  return `
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:20px 8px;animation:reveal .3s ease-out both">
      <div class="ring-wrap" style="width:96px;height:96px;margin-bottom:14px">
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="42" fill="none" stroke="var(--sunk)" stroke-width="7"/>
          <circle cx="48" cy="48" r="42" fill="none" stroke="${pctMatch >= 70 ? 'var(--success)' : 'var(--error)'}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${pctMatch / 100 * Cc} ${Cc}" transform="rotate(-90 48 48)"/>
        </svg>
        <div class="ring-center serif" style="font-size:23px;font-weight:600">${pctMatch}%</div>
      </div>
      <div class="hint" style="margin-bottom:14px">совпадение с эталоном</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:10px">${wordsHtml}</div>
      ${sess.recognized ? `<div class="hint">Распознано: «${esc(sess.recognized)}»</div>` : ''}
    </div>
    <div class="row" style="padding:14px 0 30px;gap:12px">
      <button class="btn btn-secondary" onclick="A.retrySpeak()">Ещё раз</button>
      <button class="btn btn-primary" onclick="A.ans(${pctMatch >= 70})">Дальше</button>
    </div>`;
}

/* ---------- результаты ---------- */
function vSessionResult() {
  const ok = sess.results.filter(r => r.ok).length;
  const total = sess.results.length;
  const l = LESSONS.find(x => x.id === sess.lessonId);
  const lessonBlock = l ? (() => {
    const lc = learnedCount(l);
    const pr = Math.round(lc / l.phrases.length * 100);
    return `<div class="card" style="width:100%;margin-bottom:12px">
      <div class="row" style="justify-content:space-between;margin-bottom:8px">
        <span class="hint">Прогресс урока ${l.number}</span><b class="mono" style="color:var(--accent)">${pr}%</b></div>
      <div class="progressbar"><div style="width:${pr}%"></div></div></div>`;
  })() : '';
  return `<div class="screen no-tab" style="display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
    <div style="width:96px;height:96px;border-radius:99px;background:var(--success-sunk);display:flex;align-items:center;justify-content:center;color:var(--success);margin-bottom:20px">
      <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7"/></svg></div>
    <h1 style="font-size:30px">Готово!</h1>
    <div class="sub" style="margin:8px 0 24px;font-size:16px">Верно <b class="mono" style="color:var(--t1)">${ok}</b> из <span class="mono">${total}</span></div>
    ${lessonBlock}
    <div class="row" style="width:100%;gap:10px;margin-bottom:26px">
      <div class="card grow center" style="background:var(--accent-sunk);border:none;padding:13px">${I.flame} <b>Серия ${S.streak}</b></div>
      <div class="card grow center" style="background:var(--success-sunk);border:none;padding:13px"><b>Цель дня +${ok}</b></div>
    </div>
    ${l ? (sess.type === 'words'
      ? `<button class="btn btn-primary" style="margin-bottom:10px" onclick="A.startWords(${l.id})">Ещё слова</button>
         <button class="btn btn-secondary" style="margin-bottom:10px" onclick="A.openLesson(${l.id})">К уроку</button>`
      : `<button class="btn btn-primary" style="margin-bottom:10px" onclick="A.startPractice(${l.id})">Продолжить практику</button>
         <button class="btn btn-secondary" style="margin-bottom:10px" onclick="A.openLesson(${l.id})">К уроку</button>`) : ''}
    <button class="btn btn-text" onclick="A.goTab('home')">На главную</button>
  </div>`;
}

function vExamResult() {
  const pct = V.pct;
  const pass = pct >= 80;
  const l = LESSONS.find(x => x.id === sess.lessonId);
  const Cc = 2 * Math.PI * 52;
  const rows = sess.results.map((r, i) => `
    <div class="row" style="padding:13px 14px;${i < sess.results.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}cursor:pointer"
      onclick="A.say('${esc(r.phrase.pt).replace(/'/g, "\\'")}')">
      <div class="status-dot" style="background:${r.ok ? 'var(--success-sunk)' : 'var(--error-sunk)'};color:${r.ok ? 'var(--success)' : 'var(--error)'}">${r.ok ? I.check : I.close}</div>
      <div class="grow" style="font-size:15px;text-align:left">${esc(r.phrase.pt)}</div>
      <span style="color:var(--t3)">${I.speaker()}</span>
    </div>`).join('');
  return `<div class="screen no-tab">
    <div class="center" style="margin-top:8px">
      <div class="ring-wrap" style="width:120px;height:120px;margin-bottom:12px">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--sunk)" stroke-width="9"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke="${pass ? 'var(--success)' : 'var(--accent)'}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${pct / 100 * Cc} ${Cc}" transform="rotate(-90 60 60)"/>
        </svg>
        <div class="ring-center serif mono" style="font-size:32px;font-weight:600">${pct}%</div>
      </div>
      <div class="hint" style="margin-bottom:6px">Урок ${l.number} · Экзамен</div>
      <div class="serif" style="font-size:22px;font-weight:600;color:${pass ? 'var(--success)' : 'var(--t1)'}">
        ${pass ? (l.number < 16 ? `Сдано! Урок ${l.number + 1} открыт` : 'Сдано! Курс пройден 🎉') : 'Почти! Нужно 80%'}</div>
    </div>
    <div class="group-label" style="margin-top:22px">РАЗБОР</div>
    <div class="card settings-group">${rows}</div>
    <div class="row" style="gap:12px;margin-top:22px">
      <button class="btn btn-secondary" onclick="A.startExam(${l.id})">Повторить</button>
      <button class="btn btn-primary" onclick="A.goTab('home')">Дальше</button>
    </div>
  </div>`;
}

/* ---------- Повторение ---------- */
function vReview() {
  const due = dueIds();
  const reviewedToday = Object.values(S.phrases).filter(p => p.seen > 0 && Date.now() - (p.due - BOXES[p.box]) < 864e5).length;
  const body = due.length === 0 ? `
    <div class="center" style="padding:30px 18px">
      <div style="width:96px;height:96px;border-radius:99px;background:var(--success-sunk);display:flex;align-items:center;justify-content:center;color:var(--success);margin:0 auto 18px">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7"/></svg></div>
      <div class="serif" style="font-size:22px;font-weight:600;margin-bottom:8px">Всё повторено 🎉</div>
      <div class="sub">Возвращайся позже — карточки созревают по расписанию: 10 минут → 1 день → 3 → 7 → 14.</div>
    </div>` : `
    <div class="card center" style="padding:26px 22px">
      <div style="width:80px;height:80px;border-radius:99px;background:var(--accent-sunk);display:flex;align-items:center;justify-content:center;color:var(--accent);margin:0 auto 14px">${I.review}</div>
      <div class="serif mono" style="font-size:30px;font-weight:600">${due.length}</div>
      <div class="sub" style="margin-bottom:18px">карточек к повторению</div>
      <button class="btn btn-primary" onclick="A.startReview()">Начать повторение</button>
    </div>`;
  return `<div class="screen">
    <h1>Повторение</h1>
    <div class="sub" style="margin-bottom:22px">Интервальные повторения: ошибся — вернётся скоро, знал — реже</div>
    ${body}
  </div>`;
}

/* ---------- Профиль ---------- */
/* ---------- Прогресс и аккаунт (синхронизация) ---------- */
let acRecoveryCode = '', acEmailStage = 'idle', acEmailAddr = '';
function syncStatusText() {
  if (!AUTH.token) return 'Только на этом устройстве';
  if (AUTH.secured) return syncStatus === 'off' ? 'Защищён · нет сети' : 'Защищён · синхронизируется';
  return syncStatus === 'off' ? 'На сервере · нет сети' : 'Сохраняется на сервере · не защищён';
}
function syncDotClass() {
  if (!AUTH.token || syncStatus === 'off' || syncStatus === 'local') return 'off';
  return AUTH.secured ? 'ok' : 'warn';
}
function vAccount() {
  const secured = !!AUTH.secured, dot = syncDotClass();
  return `<div class="screen no-tab" style="display:flex;flex-direction:column;padding-bottom:0">
    <button class="icon-btn" style="margin-bottom:14px" onclick="A.goTab('profile')">${I.back}<span class="sr-only">Назад</span></button>
    <div style="flex:1;overflow-y:auto">
      <h1 style="font-size:25px">Прогресс и аккаунт</h1>
      <div class="sub" style="margin:8px 0 16px">Прогресс хранится на сервере, чтобы не пропасть при очистке кеша. Защитите его — и сможете восстановить на любом устройстве.</div>
      <div class="card" style="padding:16px">
        <div class="row"><span class="sync-dot ${dot}" style="width:11px;height:11px"></span>
          <b style="font-size:15px">${secured ? 'Защищён' : (AUTH.token ? 'Сохраняется на сервере' : 'Только на устройстве')}</b></div>
        <div class="hint" style="margin-top:6px;line-height:1.5">${secured
          ? (AUTH.email ? 'Привязан email: ' + esc(AUTH.email) + '. Можно восстановить по письму.' : 'Есть код восстановления. Сохраните его в надёжном месте.')
          : 'Если очистить кеш сейчас — прогресс может пропасть. Сохраните код восстановления или привяжите email.'}</div>
      </div>
      <div class="group-label" style="margin-top:20px">ЗАЩИТИТЬ ПРОГРЕСС</div>
      <div class="card settings-group">
        ${acRecoveryCode ? `
          <div class="settings-col">
            <div class="hint" style="margin-bottom:8px">Ваш код восстановления — сохраните его:</div>
            <div class="rc-box">${esc(acRecoveryCode)}</div>
            <button class="btn btn-secondary" style="margin-top:10px" onclick="A.acCopy()">Скопировать код</button>
            <div class="hint" style="margin-top:8px;color:var(--error)">Показывается один раз. Новый код заменяет старый.</div>
          </div>` : `
          <div class="settings-row tappable" onclick="A.acShowRecovery()"><span>${secured ? 'Показать новый код восстановления' : 'Получить код восстановления'}</span><span style="color:var(--t3)">${I.chev}</span></div>`}
        ${syncEmailEnabled ? (acEmailStage === 'sent' ? `
          <div class="settings-col">
            <div class="hint" style="margin-bottom:8px">Код отправлен на ${esc(acEmailAddr)} — введите его:</div>
            <input id="ac-code" inputmode="numeric" placeholder="6 цифр" class="ac-input">
            <div class="row" style="margin-top:10px;gap:10px">
              <button class="btn btn-primary" onclick="A.acEmailVerify()">Подтвердить</button>
              <button class="btn btn-text" style="width:auto" onclick="A.acEmailCancel()">Отмена</button>
            </div>
          </div>` : `
          <div class="settings-col">
            <div style="margin-bottom:8px">Привязать email</div>
            <input id="ac-email" type="email" inputmode="email" placeholder="you@example.com" class="ac-input">
            <button class="btn btn-secondary" style="margin-top:10px" onclick="A.acEmailStart()">Получить код на email</button>
          </div>`) : ''}
      </div>
      <div class="group-label" style="margin-top:20px">ВОЙТИ / ВОССТАНОВИТЬ</div>
      <div class="card settings-group">
        <div class="settings-col">
          <div class="hint" style="margin-bottom:8px">Введите код восстановления:</div>
          <input id="ac-rc" placeholder="FALAR-XXXX-XXXX-XXXX" class="ac-input" style="text-transform:uppercase">
          <button class="btn btn-secondary" style="margin-top:10px" onclick="A.acRecover()">Восстановить прогресс</button>
        </div>
        ${syncEmailEnabled ? `<div class="settings-col"><div class="hint" style="margin-bottom:8px;line-height:1.5">…или по email: введите адрес выше («Привязать email») и код из письма. Если этот email уже использовался — вы войдёте в свой аккаунт.</div></div>` : ''}
      </div>
      <div class="group-label" style="margin-top:20px">ОПАСНАЯ ЗОНА</div>
      <div class="card settings-group" style="margin-bottom:18px">
        <div class="settings-row tappable" onclick="A.acDelete()"><span style="color:var(--error);font-weight:500">Удалить аккаунт на сервере</span></div>
      </div>
      <div class="hint" style="text-align:center;line-height:1.5;margin-bottom:18px">Без cookie и лишних данных. Анонимно, пока вы сами не привяжете email.</div>
    </div>
  </div>`;
}

function vProfile() {
  const learned = totalLearned();
  const pctCourse = Math.round(learned / TOTAL_PHRASES * 100);
  const voiceOpts = VOICES.map(v =>
    `<option value="${esc(v.voiceURI)}" ${pickVoice() && pickVoice().voiceURI === v.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
  return `<div class="screen">
    <div class="row" style="margin-bottom:22px">
      <div style="width:60px;height:60px;border-radius:99px;background:var(--accent-sunk);display:flex;align-items:center;justify-content:center;font-family:Lora,serif;font-size:25px;font-weight:600;color:var(--accent);flex:none">F</div>
      <div><div class="row" style="gap:6px">${I.flame}<span class="serif mono" style="font-size:24px;font-weight:600">${S.streak}</span><span class="hint" style="font-size:14px">дней подряд</span></div>
      <div class="hint" style="margin-top:2px">Лучшая серия: ${S.bestStreak}</div></div>
    </div>

    <div class="statgrid" style="margin-bottom:18px">
      <div class="card"><div class="statnum mono">${learned}</div><div class="statlabel">Освоено фраз</div></div>
      <div class="card"><div class="statnum mono" style="color:var(--accent)">${pctCourse}%</div><div class="statlabel">Пройдено курса</div></div>
    </div>

    <div class="card row tappable" style="margin-bottom:18px" onclick="A.openAccount()">
      <div style="width:38px;height:38px;border-radius:11px;background:var(--accent-sunk);display:flex;align-items:center;justify-content:center;color:var(--accent);flex:none">${I.shield}</div>
      <div class="grow"><h2 style="font-size:16px">Прогресс и аккаунт</h2><div class="hint" style="margin-top:1px"><span class="sync-dot ${syncDotClass()}"></span>${esc(syncStatusText())}</div></div>
      <span style="color:var(--t3)">${I.chev}</span>
    </div>

    <div class="card row tappable" style="margin-bottom:18px" onclick="A.go('verbmap')">
      <div style="width:38px;height:38px;border-radius:11px;background:var(--accent-sunk);display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px;padding:7px;flex:none">
        ${['var(--accent)', 'var(--success)', 'var(--lock)', 'var(--success)', 'var(--accent)', 'var(--lock)'].map(c => `<div style="background:${c};border-radius:1.5px;opacity:${c.includes('lock') ? '.4' : '1'}"></div>`).join('')}
      </div>
      <div class="grow"><h2 style="font-size:16px">Карта базовой таблицы</h2><div class="hint" style="margin-top:1px">Какие структуры на автомате</div></div>
      <span style="color:var(--t3)">${I.chev}</span>
    </div>

    <div class="group-label">ОЗВУЧКА</div>
    <div class="card settings-group" style="margin-bottom:18px">
      <div class="settings-row"><span>Голос (pt)</span>
        ${VOICES.length ? `<select onchange="A.setVoice(this.value)">${voiceOpts}</select>` : '<span class="hint">не найдены — проверь язык системы</span>'}</div>
      <div class="settings-col"><div style="margin-bottom:8px">Скорость речи</div>
        <input type="range" min="0.6" max="1.2" step="0.05" value="${S.settings.rate}" style="width:100%" onchange="A.setRate(this.value)"></div>
      <div class="settings-row"><span>Авто-озвучка ответа</span>
        <button class="toggle ${S.settings.autoSpeak ? 'on' : ''}" onclick="A.toggleAuto()"></button></div>
      <div class="settings-row"><span>Звук ответа</span>
        <button class="toggle ${S.settings.sound !== false ? 'on' : ''}" onclick="A.toggleSound()"></button></div>
    </div>

    <div class="group-label">ОБУЧЕНИЕ</div>
    <div class="card settings-group" style="margin-bottom:18px">
      <div class="settings-col"><div style="margin-bottom:10px">Цель в день</div>
        <div class="seg">${[10, 20, 30].map(n => `<button class="${S.dayGoal === n ? 'on' : ''}" onclick="A.setGoal(${n})">${n}</button>`).join('')}</div></div>
      <div class="settings-col"><div style="margin-bottom:10px">Режим повторения (вкладка «Повторение»)</div>
        <div class="seg">${MODE_ORDER.map(m => `<button class="${S.settings.defaultMode === m ? 'on' : ''}" onclick="A.setDefMode('${m}')">${MODE_LABEL[m]}</button>`).join('')}</div></div>
    </div>

    <div class="group-label">ВНЕШНИЙ ВИД</div>
    <div class="card settings-group" style="margin-bottom:18px">
      <div class="settings-col"><div style="margin-bottom:10px">Тема</div>
        <div class="seg">${[['system', 'Системная'], ['light', 'Светлая'], ['dark', 'Тёмная']]
          .map(([t, lbl]) => `<button class="${S.theme === t ? 'on' : ''}" onclick="A.setTheme('${t}')">${lbl}</button>`).join('')}</div></div>
    </div>

    <div class="card settings-group">
      <div class="settings-row tappable" onclick="A.resetProgress()"><span style="color:var(--error);font-weight:500">Сбросить прогресс</span></div>
      <div class="settings-row"><span class="hint">Версия (web-тест)</span><span class="hint">0.1 · ${LESSONS.length} уроков, ${TOTAL_PHRASES} фраз</span></div>
    </div>
    <div class="hint" style="text-align:center;margin-top:14px;line-height:1.5">Собирается анонимная статистика использования, чтобы улучшать приложение. Без файлов cookie, без личных данных.</div>
  </div>`;
}

/* ---------- Карта таблицы ---------- */
let mapConj = 'ar';
function vVerbmap() {
  const cols = ['Настоящее', 'Прошедшее', 'Будущее'];
  const tenseGroup = { present: 0, continuous: 0, past: 1, imperfect: 1, future: 2, mixed: 0 };
  const forms = ['affirm', 'negate', 'question'];
  const signs = ['+', '–', '?'];
  // агрегируем по ячейке: уровень от доли выученных фраз + глубины (box)
  const agg = forms.map(() => [null, null, null].map(() => ({ n: 0, learned: 0, boxSum: 0, seen: 0 })));
  Object.keys(ALL_PHRASES).forEach(id => {
    const { p } = ALL_PHRASES[id];
    if (p.conjugation !== mapConj) return;
    const f = forms.indexOf(p.form); const t = tenseGroup[p.tense];
    if (f < 0 || t === undefined) return;
    const st = S.phrases[id];
    const a = agg[f][t];
    a.n++;
    if (st && st.seen > 0) { a.seen++; a.boxSum += Math.min(3, st.box); if (st.learned) a.learned++; }
  });
  function cellLevel(a) {
    if (a.n === 0 || a.seen === 0) return 0;
    const cov = a.learned / a.n;
    const depth = a.boxSum / Math.max(1, a.seen);
    if (cov >= 0.9 && depth >= 2) return 3;   // автомат
    if (cov >= 0.6) return 2;                 // уверенно
    return 1;                                 // учится
  }
  const colors = ['var(--sunk)', 'var(--accent-sunk)', 'var(--accent)', 'var(--success)'];
  const grid = `<div class="vtable">
    <div></div>${cols.map(c => `<div class="head">${c}</div>`).join('')}
    ${forms.map((f, fi) => `
      <div class="sign">${signs[fi]}</div>
      ${cols.map((_, ti) => {
        const a = agg[fi][ti];
        const lv = cellLevel(a);
        return `<div class="vcell" style="background:${colors[lv]};color:${lv >= 2 ? '#fff' : 'var(--t3)'};aspect-ratio:1.6;display:flex;align-items:center;justify-content:center;cursor:default">${signs[fi]}</div>`;
      }).join('')}`).join('')}
  </div>`;
  const legend = ['Не начато', 'Учится', 'Уверенно', 'Автомат'].map((l, i) =>
    `<div class="row" style="gap:6px"><span style="width:14px;height:14px;border-radius:5px;background:${colors[i]}"></span><span class="hint">${l}</span></div>`).join('');
  return `<div class="screen no-tab">
    <button class="icon-btn" style="margin-bottom:16px" onclick="A.goTab('profile')">${I.back}<span class="sr-only">Назад</span></button>
    <h1 style="font-size:26px">Карта таблицы</h1>
    <div class="sub" style="margin-bottom:18px">Насыщенность ячейки = уровень освоения структуры</div>
    <div class="seg" style="margin-bottom:18px">
      ${[['ar', '-ar'], ['er', '-er'], ['ir', '-ir'], ['irregular', 'неправ.']].map(([c, lbl]) =>
        `<button class="${mapConj === c ? 'on' : ''}" onclick="A.setMapConj('${c}')">${lbl}</button>`).join('')}
    </div>
    <div class="card" style="padding:16px">${grid}</div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:16px">${legend}</div>
  </div>`;
}

/* ---------- режим «1000 слов» (RU): экраны ---------- */
const POS_LABEL = {
  verb: 'глагол', noun: 'сущ.', adj: 'прил.', adv: 'нареч.', pron: 'мест.',
  prep: 'предлог', conj: 'союз', num: 'числ.', det: 'опред.', interj: 'межд.', phrase: 'фраза',
};
function w1kDots(st) {
  return `<span class="sdots">${[0, 1, 2].map(k => `<span class="sdot ${k < st ? 'on' : ''}"></span>`).join('')}</span>`;
}
function vW1kHome() {
  w1kMigrate();
  const total = W1K().length;
  const learned = w1kLearnedCount();
  const active = w1kRefillActive();
  const pct = total ? Math.round(learned / total * 100) : 0;
  const Cc = 2 * Math.PI * 46;
  const activeRows = active.map(pt => {
    const w = W1K().find(x => x.pt === pt) || { ru: '' };
    const st = w1kStreak(pt);
    return `<div class="card row" style="padding:11px 14px">
      <div class="grow"><b style="font-size:16px">${esc(pt)}</b> <span class="hint">— ${esc(w.ru)}</span></div>
      ${w1kDots(st)}</div>`;
  }).join('') || `<div class="hint center" style="padding:16px">Все слова изучены 🎉</div>`;
  const learnedList = w1kState().learned.length
    ? w1kState().learned.map(pt => {
      const w = W1K().find(x => x.pt === pt) || { ru: '' };
      return `<div class="card row" style="padding:11px 14px">
        <div class="grow"><b style="font-size:15px">${esc(pt)}</b> <span class="hint">— ${esc(w.ru)}</span></div>
        <button class="btn-relearn" onclick="A.w1kRelearn('${esc(pt).replace(/'/g, "\\'")}')">Изучать заново</button></div>`;
    }).join('')
    : `<div class="hint center" style="padding:16px">Пока нет изученных слов. Слово попадает сюда после 3 верных ответов подряд.</div>`;
  return `<div class="screen no-tab" style="display:flex;flex-direction:column;padding-bottom:0">
    <button class="icon-btn" style="margin-bottom:14px" onclick="A.goTab('home')">${I.back}<span class="sr-only">Назад</span></button>
    <div style="flex:1;overflow-y:auto">
      <h1 style="font-size:26px">Слова учебника</h1>
      <div class="sub" style="margin:8px 0 16px">Слова юнитов 1–12. Урок — 5 слов. Слово уходит в изученные после 3 верных ответов подряд (PT ⇄ RU).</div>
      <div class="card row" style="padding:16px 18px">
        <div class="ring-wrap" style="width:60px;height:60px;flex:none">
          <svg width="60" height="60" viewBox="0 0 60 60">
            <circle cx="30" cy="30" r="26" fill="none" stroke="var(--sunk)" stroke-width="6"/>
            <circle cx="30" cy="30" r="26" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${pct / 100 * 2 * Math.PI * 26} ${2 * Math.PI * 26}" transform="rotate(-90 30 30)"/>
          </svg>
          <div class="ring-center"><b class="serif mono" style="font-size:15px">${learned}</b></div>
        </div>
        <div class="grow"><div class="serif" style="font-size:17px;font-weight:600">Изучено ${learned} из ${total}</div>
          <div class="hint" style="margin-top:2px">В работе: ${active.length} · в уроке — следующие слова из учебника</div></div>
      </div>
      <div class="group-label" style="margin-top:20px">В ЭТОМ УРОКЕ (${active.length})</div>
      <div style="display:flex;flex-direction:column;gap:10px">${activeRows}</div>
      <div class="group-label" style="margin-top:20px">ИЗУЧЕННЫЕ СЛОВА (${w1kState().learned.length})</div>
      <div style="display:flex;flex-direction:column;gap:10px">${learnedList}</div>
    </div>
    <div style="padding:14px 0 28px;background:linear-gradient(to top,var(--canvas) 78%,transparent)">
      ${w1kState().learned.length ? `<button class="btn btn-secondary" style="margin-bottom:10px" onclick="A.startW1kReview()">Повторение изученных (${w1kState().learned.length})</button>` : ''}
      <button class="btn btn-primary" ${active.length === 0 ? 'disabled' : ''} onclick="A.startW1k()">Учить</button>
    </div>
  </div>`;
}
function vW1kSession() {
  const c = wsess.card;
  const review = wsess.kind === 'review';
  const promptWord = c.dir === 'pt2ru' ? c.pt : c.ru;
  const promptLang = c.dir === 'pt2ru' ? 'pt' : 'ru';
  const askLabel = c.dir === 'pt2ru' ? 'Выберите перевод' : 'Выберите слово по-португальски';
  const st = review ? (wsess.reviewStreak[c.pt] || 0) : w1kStreak(c.pt);
  const speakBtnHTML = c.dir === 'pt2ru'
    ? `<button class="btn btn-text" style="width:auto;height:auto;margin-top:10px;font-size:14px" onclick="A.say('${esc(c.pt).replace(/'/g, "\\'")}')">${I.speaker()} Слушать</button>` : '';
  const opts = c.options.map((o, i) => {
    let cls = 'w1k-opt';
    if (wsess.answered) {
      if (i === c.correctIndex) cls += ' ok';
      else if (i === wsess.picked) cls += ' bad';
      else cls += ' dim';
    }
    return `<button class="${cls}" ${wsess.answered ? 'disabled' : ''} onclick="A.w1kPick(${i})">${esc(o)}</button>`;
  }).join('');
  return `<div class="screen no-tab" style="display:flex;flex-direction:column;padding-bottom:0">
    <div class="row">
      <button class="icon-btn" style="background:none" onclick="A.goTab('home')">${I.close}<span class="sr-only">Закрыть</span></button>
      <div class="progressbar"><div style="width:${wsess.answered ? 100 : 45}%"></div></div>
      <span class="hint mono">${wsess.results.filter(Boolean).length} ✓</span>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:16px 0">
      <div class="hint center" style="margin-bottom:6px">${review ? 'Повторение · ' : ''}${askLabel} · <span style="color:var(--t3)">${POS_LABEL[c.pos] || ''}</span></div>
      <div class="center" style="margin-bottom:10px">${w1kDots(st)}</div>
      <div class="center" style="margin-bottom:8px"><span class="${promptLang === 'pt' ? 'phrase-pt' : 'phrase-ru'}">${esc(promptWord)}</span></div>
      <div class="center">${speakBtnHTML}</div>
      <div class="w1k-opts">${opts}</div>
    </div>
    <div style="padding:14px 0 28px">
      ${wsess.answered
        ? `<button class="btn btn-primary" onclick="A.w1kNext()">Дальше</button>`
        : `<div class="hint center" style="padding:13px 0">Выберите один вариант</div>`}
    </div>
  </div>`;
}

/* ---------- тренажёр форм глаголов (RU): экраны ---------- */
function vVerbHome() {
  const s = vtState();
  const active = refillActive();
  const pool = verbPool();
  const poolN = pool.length;
  const masteredArr = verbMasteredList();
  const masteredN = masteredArr.length;
  const pct = poolN ? Math.round(masteredN / poolN * 100) : 0;
  const Cc = 2 * Math.PI * 46;
  const activeRows = active.map(inf => {
    const row = VLIST().find(v => v.inf === inf) || { ru: '' };
    const lc = verbLearnedCells(inf), tot = verbCellTotal(inf) || 1;
    return `<div class="card row" style="padding:12px 14px">
      <button class="vcell" style="width:auto;padding:8px 12px;flex:none" onclick="A.say('${esc(inf)}')">${esc(inf)}</button>
      <div class="grow"><div class="hint" style="margin-bottom:5px">${esc(row.ru)}</div>
        <div class="miniprog"><div class="bar"><div style="width:${Math.round(lc / tot * 100)}%"></div></div><span class="mono">${lc}/${tot}</span></div></div>
    </div>`;
  }).join('');
  const masteredList = masteredN ? masteredArr.map(inf => {
    const row = VLIST().find(v => v.inf === inf) || { ru: '' };
    return `<div class="card row tappable" style="padding:12px 14px" onclick="A.openVerbForms('${esc(inf)}')">
      <div class="grow"><b style="font-size:16px">${esc(inf)}</b> <span class="hint">— ${esc(row.ru)}</span></div>
      <span style="color:var(--t3)">${I.chev}</span></div>`;
  }).join('') : `<div class="hint center" style="padding:18px">Пока нет освоенных глаголов. Осваивай формы — глагол попадёт сюда, когда выучишь ${s.mode === 'lessons' ? 'все встречавшиеся формы' : '≥90% форм'}.</div>`;
  return `<div class="screen no-tab" style="display:flex;flex-direction:column;padding-bottom:0">
    <button class="icon-btn" style="margin-bottom:14px" onclick="A.goTab('home')">${I.back}<span class="sr-only">Назад</span></button>
    <div style="flex:1;overflow-y:auto">
      <h1 style="font-size:26px">Формы глаголов</h1>
      <div class="sub" style="margin:8px 0 18px">Подбери верную форму — проверяются и лицо, и время.</div>
      <div class="seg" style="margin-bottom:18px">
        <button class="${s.mode === 'all' ? 'on' : ''}" onclick="A.setVerbMode('all')">Все глаголы</button>
        <button class="${s.mode === 'lessons' ? 'on' : ''}" onclick="A.setVerbMode('lessons')">Из открытых уроков</button>
      </div>
      <div class="card center" style="padding:22px">
        <div class="ring-wrap" style="width:104px;height:104px;margin:0 auto 12px">
          <svg width="104" height="104" viewBox="0 0 104 104">
            <circle cx="52" cy="52" r="46" fill="none" stroke="var(--sunk)" stroke-width="8"/>
            <circle cx="52" cy="52" r="46" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${pct / 100 * Cc} ${Cc}" transform="rotate(-90 52 52)"/>
          </svg>
          <div class="ring-center"><b class="serif mono" style="font-size:22px">${masteredN}</b><span style="font-size:11px;color:var(--t3)">/${poolN}</span></div>
        </div>
        <div class="serif" style="font-size:17px;font-weight:600">Освоено ${masteredN} из ${poolN}</div>
        <div class="hint" style="margin-top:3px">${s.mode === 'lessons' ? 'Глаголы и формы из открытых уроков' : 'Все глаголы по частоте'}</div>
      </div>
      <div class="card row tappable" style="margin-top:12px;padding:13px 16px" onclick="A.openVerbList()">
        <div style="width:38px;height:38px;border-radius:11px;background:var(--accent-sunk);display:flex;align-items:center;justify-content:center;color:var(--accent);flex:none">${I.book}</div>
        <div class="grow"><h2 style="font-size:16px">Все глаголы — таблицы форм</h2><div class="hint" style="margin-top:1px">Список из ${VLIST().length} глаголов по частоте · спряжение каждого</div></div>
        <span style="color:var(--t3)">${I.chev}</span>
      </div>
      ${poolN === 0 ? `<div class="card" style="background:var(--accent-sunk);border:none;padding:14px 16px;margin-top:14px"><div class="hint" style="line-height:1.5;color:var(--t2)">В открытых уроках пока нет глаголов из списка. Открой больше уроков (сдавай экзамены) или переключись на «Все глаголы».</div></div>` : `
      <div class="group-label" style="margin-top:22px">В РАБОТЕ (${active.length})</div>
      <div style="display:flex;flex-direction:column;gap:10px">${activeRows}</div>`}
      <div class="group-label" style="margin-top:22px">ИЗУЧЕННЫЕ ГЛАГОЛЫ (${masteredN})</div>
      <div style="display:flex;flex-direction:column;gap:10px">${masteredList}</div>
    </div>
    <div style="padding:14px 0 28px;background:linear-gradient(to top,var(--canvas) 78%,transparent)">
      <button class="btn btn-primary" ${poolN === 0 ? 'disabled' : ''} onclick="A.startVerbs()">Тренировать</button>
    </div>
  </div>`;
}
function vVerbSession() {
  const c = vsess.card;
  const sentence = `${VTENSE_HINT[c.tense]}, ${VPRON[c.idx]} <span class="vblank">___</span>.`;
  const opts = c.options.map((o, i) => {
    let cls = 'w1k-opt';
    if (vsess.answered) {
      if (i === c.correctIndex) cls += ' ok';
      else if (i === vsess.picked) cls += ' bad';
      else cls += ' dim';
    }
    return `<button class="${cls}" ${vsess.answered ? 'disabled' : ''} onclick="A.verbPick(${i})">${esc(o)}</button>`;
  }).join('');
  return `<div class="screen no-tab" style="display:flex;flex-direction:column;padding-bottom:0">
    <div class="row">
      <button class="icon-btn" style="background:none" onclick="A.goTab('home')">${I.close}<span class="sr-only">Закрыть</span></button>
      <div class="progressbar"><div style="width:${vsess.answered ? 100 : 40}%"></div></div>
      <span class="hint mono">${vsess.results.length} ✓</span>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:16px 0">
      <div class="center" style="margin-bottom:6px"><span class="pill pill-accent">${VTENSE_LABEL[c.tense]}</span></div>
      <div class="hint center" style="margin-bottom:14px">${esc(c.inf)} — ${esc(c.ru)}</div>
      <div class="phrase-pt center" style="font-size:24px;margin-bottom:6px">${sentence}</div>
      ${vsess.answered ? `<div class="center" style="margin-top:6px"><button class="btn btn-text" style="width:auto;height:auto;font-size:14px" onclick="A.say('${esc(VPRON[c.idx] + ' ' + c.correct)}')">${I.speaker()} ${esc(VPRON[c.idx])} ${esc(c.correct)}</button></div>` : ''}
      <div class="w1k-opts">${opts}</div>
    </div>
    <div style="padding:14px 0 28px">
      ${vsess.answered ? `<button class="btn btn-primary" onclick="A.verbNext()">Дальше</button>` : `<div class="hint center" style="padding:13px 0">Выберите верную форму</div>`}
    </div>
  </div>`;
}
// список всех глаголов по частоте — тап открывает таблицу форм
function vVerbList() {
  const rows = VLIST().map((v, i) => `
    <div class="card row tappable" style="padding:11px 14px" onclick="A.openVerbForms('${esc(v.inf).replace(/'/g, "\\'")}','verbList')">
      <span class="mono" style="color:var(--t3);font-size:13px;width:34px;flex:none">${i + 1}</span>
      <div class="grow"><b style="font-size:16px">${esc(v.inf)}</b> <span class="hint">— ${esc(v.ru)}</span></div>
      <span style="color:var(--t3)">${I.chev}</span></div>`).join('');
  return `<div class="screen no-tab" style="display:flex;flex-direction:column;padding-bottom:0">
    <button class="icon-btn" style="margin-bottom:14px" onclick="A.go('verbHome')">${I.back}<span class="sr-only">Назад</span></button>
    <div style="flex:1;overflow-y:auto">
      <h1 style="font-size:25px">Все глаголы</h1>
      <div class="sub" style="margin:8px 0 16px">${VLIST().length} глаголов по частоте. Нажми — таблица всех форм.</div>
      <div style="display:flex;flex-direction:column;gap:8px">${rows}</div>
    </div>
  </div>`;
}
function vVerbForms() {
  const inf = V.verbInf;
  const back = V.verbFrom === 'verbList' ? 'verbList' : 'verbHome';
  const row = VLIST().find(v => v.inf === inf) || { ru: '' };
  const blocks = VTENSES.map(t => `
    <div class="vf-block">
      <div class="vf-tense">${esc(VTENSE_LABEL[t])}</div>
      <div class="chips">${[0, 1, 2, 3, 4].map(i => {
        const f = conjugate(inf, t, i);
        return `<button class="chip" onclick="A.cellTap(this,'${esc(VPRON[i] + ' ' + f).replace(/'/g, "\\'")}')"><span class="vf-pron">${esc(VPRON[i])}</span> <b>${esc(f)}</b></button>`;
      }).join('')}</div>
    </div>`).join('');
  return `<div class="screen no-tab">
    <button class="icon-btn" style="margin-bottom:14px" onclick="A.go('${back}')">${I.back}<span class="sr-only">Назад</span></button>
    <h1 style="font-size:25px">${esc(inf)}</h1>
    <div class="sub" style="margin-bottom:18px">${esc(row.ru)} · 4 времени × 5 лиц</div>
    <div class="card" style="padding:14px">${blocks}
      <div class="hint center" style="margin-top:6px">${I.speaker()} Тап по форме — озвучка</div>
    </div>
  </div>`;
}

/* ---------------- обработчики ---------------- */
window.A = {
  goTab, go: (n) => go(n),
  setGoal(n) { S.dayGoal = n; save(); render(); },
  onbNext() { if (onbStep < 2) { onbStep++; render(); } else A.finishOnb(); },
  finishOnb() { S.onboarded = true; save(); track('onboarding_done'); render(); },

  openLesson(id) { track('lesson_open', { lesson: id }); go('lesson', { lessonId: id }); window.scrollTo(0, 0); },
  lockedTap() { toast('Урок откроется после сдачи экзамена предыдущего (≥80%)'); },
  examLockedTap() { toast(`Допуск: ${HIST_PASS} верных из ${HIST_WINDOW} последних плиток — режим «Плитки» в практике`); },
  openTheory(id) { const ld = ldata(id); ld.theoryRead = true; save(); track('theory_open', { lesson: id }); go('theory', { lessonId: id }); window.scrollTo(0, 0); },
  cellTap(el, text) {
    document.querySelectorAll('.vcell.on').forEach(c => c.classList.remove('on'));
    el.classList.add('on');
    speak(text);
  },
  say(text, slow) { speak(text, !!slow); },

  startPractice(id) { startSession('practice', id); },
  startWords(id) { startSession('words', id); },
  openW1k() { w1kMigrate(); track('screen', { name: 'w1kHome' }); go('w1kHome'); window.scrollTo(0, 0); },
  startW1k() {
    w1kMigrate();
    const recent = [];
    const card = w1kNextLearnCard(null, recent);
    if (!card) { toast('Все слова изучены — откройте повторение'); return; }
    wsess = { kind: 'learn', card, answered: false, picked: null, results: [], lastDir: card.dir, recent };
    track('words1000_start', { mode: 'learn' });
    go('w1kSession'); window.scrollTo(0, 0);
  },
  startW1kReview() {
    const learned = w1kState().learned.slice();
    if (!learned.length) { toast('Пока нет изученных слов'); return; }
    const ws = { kind: 'review', reviewPool: shuffle(learned), reviewStreak: {}, answered: false, picked: null, results: [], lastDir: 'ru2pt', recent: [] };
    const card = w1kNextReviewCard(ws);
    if (!card) { toast('Нет слов для повторения'); return; }
    ws.card = card; wsess = ws;
    track('words1000_start', { mode: 'review', size: learned.length });
    go('w1kSession'); window.scrollTo(0, 0);
  },
  w1kPick(i) {
    if (!wsess || wsess.answered) return;
    const c = wsess.card;
    const ok = i === c.correctIndex;
    wsess.answered = true; wsess.picked = i;
    wsess.results.push(ok);
    playSound(ok);
    let newlyLearned = false, knockedOut = false;
    if (wsess.kind === 'review') {
      wsess.reviewStreak[c.pt] = ok ? (wsess.reviewStreak[c.pt] || 0) + 1 : 0;
      knockedOut = (wsess.reviewStreak[c.pt] || 0) >= 3;
      markActivity();
    } else {
      newlyLearned = w1kGradeWord(c.pt, ok);
    }
    save();
    track('words1000_answer', { dir: c.dir, ok, mode: wsess.kind });
    if (ok && S.settings.autoSpeak) speak(c.pt);
    render();
    if (newlyLearned) toast(`Слово «${c.pt}» изучено! 🎉`);
    else if (knockedOut) toast(`«${c.pt}» — закреплено`);
  },
  w1kNext() {
    if (!wsess) { goTab('home'); return; }
    if (!wsess.recent) wsess.recent = [];
    const card = wsess.kind === 'review' ? w1kNextReviewCard(wsess) : w1kNextLearnCard(wsess.lastDir, wsess.recent);
    if (!card) {
      const review = wsess.kind === 'review';
      wsess = null; go('w1kHome'); window.scrollTo(0, 0);
      toast(review ? 'Повторение завершено 🎉' : 'Все слова изучены 🎉');
      return;
    }
    wsess.card = card; wsess.lastDir = card.dir; wsess.answered = false; wsess.picked = null;
    render(); window.scrollTo(0, 0);
  },
  w1kRelearn(pt) {
    const s = w1kState();
    s.learned = s.learned.filter(x => x !== pt);
    s.active = s.active.filter(x => x !== pt);
    if (s.items[pt]) s.items[pt].streak = 0; else s.items[pt] = { streak: 0 };
    save(); track('words1000_relearn', { pt }); render();
    toast(`«${pt}» возвращено в изучение`);
  },
  openVerbs() { track('screen', { name: 'verbHome' }); go('verbHome'); window.scrollTo(0, 0); },
  setVerbMode(m) { vtState().mode = m; vtState().active = []; save(); render(); },
  openVerbList() { track('screen', { name: 'verbList' }); go('verbList'); window.scrollTo(0, 0); },
  openVerbForms(inf, from) { go('verbForms', { verbInf: inf, verbFrom: from || 'verbHome' }); window.scrollTo(0, 0); },
  startVerbs() {
    const card = buildVerbCard();
    if (!card) { toast('Нет доступных глаголов'); return; }
    vsess = { card, answered: false, picked: null, results: [] };
    track('verbs_start', { mode: vtState().mode });
    go('verbSession'); window.scrollTo(0, 0);
  },
  verbPick(i) {
    if (!vsess || vsess.answered) return;
    const c = vsess.card;
    const ok = i === c.correctIndex;
    vsess.answered = true; vsess.picked = i;
    vsess.results.push(ok);
    const newlyMastered = verbGrade(c.inf, c.tense, c.idx, ok);
    save();
    track('verbs_answer', { verb: c.inf, tense: c.tense, ok });
    playSound(ok);
    if (ok && S.settings.autoSpeak) speak(VPRON[c.idx] + ' ' + c.correct);
    render();
    if (newlyMastered) { const row = VLIST().find(v => v.inf === c.inf); toast(`Глагол «${c.inf}» освоен! 🎉`); }
  },
  verbNext() {
    if (!vsess) { goTab('home'); return; }
    const card = buildVerbCard();
    if (!card) { vsess = null; go('verbHome'); window.scrollTo(0, 0); toast('Все доступные глаголы освоены 🎉'); return; }
    vsess.card = card; vsess.answered = false; vsess.picked = null;
    render(); window.scrollTo(0, 0);
  },
  startExam(id) { startSession('exam', id); },
  startReview() {
    if (!dueIds().length) { toast('Пока нечего повторять'); goTab('review'); return; }
    startSession('review', null);
  },
  exitSession() {
    // все данные ответы уже сохранены (история 100 плиток переживает выход)
    if (!sess) { goTab('home'); return; }
    const answered = sess.results.length;
    const lid = sess.lessonId;
    if (answered === 0) { sess = null; if (lid) A.openLesson(lid); else goTab('home'); return; }
    if (isEndless()) { finishSession(); return; }            // плитки: выход = завершить с итогами
    if (sess.type === 'exam') {
      if (confirm('Прервать экзамен? Результат не будет засчитан.')) { sess = null; A.openLesson(lid); }
      return;
    }
    if (confirm('Завершить сессию досрочно? Ответы уже сохранены.')) finishSession();
  },
  setMode(m) {
    sess.mode = m;
    if (sess.type === 'practice') {
      // у плиток бесконечная колода, у остальных — порция из 10: пересобираем очередь
      sess.queue = buildPracticeQueue(LESSONS.find(l => l.id === sess.lessonId), m);
      sess.i = 0;
    }
    initCard(); render();
  },
  reveal() { sess.phase = 'a'; render(); if (S.settings.autoSpeak) speak(cur().pt); },
  ans(ok) { playSound(ok); answer(ok); },

  tapBank(i) { const t = sess.builder.bank[i]; if (!t || t.used) return; t.used = true; sess.builder.slot.push(t); renderBuilderZones(); },
  tapSlot(i) { const t = sess.builder.slot.splice(i, 1)[0]; if (t) t.used = false; renderBuilderZones(); },
  tileDown(e, kind, index) {
    if (e.button != null && e.button > 0) return;
    const t = kind === 'bank' ? sess.builder.bank[index] : sess.builder.slot[index];
    if (!t || (kind === 'bank' && t.used)) return;
    drag = { kind, index, tile: t, el: e.currentTarget, x0: e.clientX, y0: e.clientY, moved: false, clone: null, insIndex: null };
    document.addEventListener('pointermove', tileDragMove);
    document.addEventListener('pointerup', tileDragUp);
    document.addEventListener('pointercancel', tileDragUp);
  },
  glossWordIdx(el, idx) {
    const g = cur() && cur().gloss;
    const pt = Array.isArray(g) ? (g[idx] || '') : glossLookup(el.textContent);
    showGloss(el, pt);
  },
  sayGloss(e, pt) { if (e && e.stopPropagation) e.stopPropagation(); speak(pt); },
  checkBuilder() {
    if (!sess.builder.slot.length) return;
    const ev = evalBuilder(sess.builder.slot.map(t => t.w), sess.builder.words);
    playSound(ev.correct);
    sess.phase = 'a'; render(); if (S.settings.autoSpeak) speak(cur().pt);
  },
  nextBuilder(ok) { answer(ok); },

  startRec() {
    sess.speakState = 'recording'; sess.recognized = ''; sess.micError = ''; render();
    try {
      startRecognition(
        (text) => {
          sess.recognized = text; render();
          // фраза произнесена целиком (с учётом опускания местоимений) → завершаем запись
          const ref = normWords(cur().pt), said = normWords(text);
          if (ref.length && ref.every(w => isSubjPron(w) || said.includes(w))) stopRecognition();
        },
        (finalText) => { if (sess && sess.speakState === 'recording') { sess.recognized = finalText || sess.recognized; sess.speakState = 'done'; sess.phase = 'a'; render(); } },
        (err) => {
          sess.speakState = 'idle';
          sess.micError = err === 'not-allowed' ? 'Нет доступа к микрофону — разреши в настройках браузера' : 'Ошибка распознавания: ' + err;
          render();
        });
    } catch (e) { sess.speakState = 'idle'; sess.micError = 'Не удалось запустить распознавание'; render(); }
  },
  stopRec() { stopRecognition(); },
  retrySpeak() { sess.phase = 'q'; sess.speakState = 'idle'; sess.recognized = ''; render(); },
  skipSpeak() { answer(false); },

  setVoice(uri) { S.settings.voiceURI = uri; save(); speak('Olá! Eu falo português.'); },
  setRate(v) { S.settings.rate = parseFloat(v); save(); speak('Eu falo português.'); },
  toggleAuto() { S.settings.autoSpeak = !S.settings.autoSpeak; save(); render(); },
  toggleSound() { S.settings.sound = (S.settings.sound === false); save(); render(); if (S.settings.sound) playSound(true); },
  setDefMode(m) { S.settings.defaultMode = m; save(); render(); },
  setTheme(t) { S.theme = t; save(); render(); },
  setMapConj(c) { mapConj = c; render(); },
  resetProgress() {
    if (confirm('Точно сбросить весь прогресс?')) { localStorage.removeItem(STORE_KEY); S = load(); onbStep = 0; goTab('home'); }
  },

  openAccount() { acRecoveryCode = ''; acEmailStage = 'idle'; acEmailAddr = ''; track('screen', { name: 'account' }); go('account'); window.scrollTo(0, 0); },
  dismissNudge() { S.nudgeSecureDismissed = true; save(); render(); },
  async acShowRecovery() {
    if (!await ensureAccount()) { toast('Нет связи с сервером'); return; }
    await pushProgress(true);
    const r = await api('POST', '/recovery/create');
    if (r.status === 200 && r.data && r.data.code) { acRecoveryCode = r.data.code; AUTH.secured = true; authSave(); render(); }
    else toast('Не удалось получить код');
  },
  acCopy() { try { navigator.clipboard.writeText(acRecoveryCode); toast('Код скопирован'); } catch (e) { toast('Скопируйте вручную'); } },
  async acEmailStart() {
    const el = document.getElementById('ac-email'); const email = ((el && el.value) || '').trim();
    if (!email) { toast('Введите email'); return; }
    if (!await ensureAccount()) { toast('Нет связи с сервером'); return; }
    const r = await api('POST', '/email/start', { email });
    if (r.status === 200) { acEmailAddr = email; acEmailStage = 'sent'; render(); }
    else if (r.status === 503) toast('Email пока недоступен');
    else if (r.status === 429) toast('Слишком часто — попробуйте позже');
    else toast('Не удалось отправить код');
  },
  async acEmailVerify() {
    const el = document.getElementById('ac-code'); const code = ((el && el.value) || '').trim();
    if (!code) return;
    await pushProgress(true);
    const r = await api('POST', '/email/verify', { email: acEmailAddr, code });
    if (r.status === 200 && r.data) {
      if (r.data.mode === 'login' && r.data.token) {
        AUTH = { token: r.data.token, accountId: r.data.accountId, email: r.data.email, secured: true }; authSave();
        S._v = 0; persistLocal(); await pullProgress();
        toast('Вход выполнен — прогресс восстановлен');
      } else {
        AUTH.email = r.data.email || acEmailAddr; AUTH.secured = true; authSave();
        toast('Email привязан');
      }
      acEmailStage = 'idle'; render();
    } else if (r.status === 400) toast('Неверный или просроченный код');
    else toast('Не удалось подтвердить');
  },
  acEmailCancel() { acEmailStage = 'idle'; render(); },
  async acRecover() {
    const el = document.getElementById('ac-rc'); const code = ((el && el.value) || '').trim();
    if (!code) return;
    const r = await api('POST', '/recovery/login', { code }, false);
    if (r.status === 200 && r.data && r.data.token) {
      AUTH = { token: r.data.token, accountId: r.data.accountId, email: r.data.email, secured: true }; authSave();
      S._v = 0; persistLocal(); await pullProgress();
      acRecoveryCode = ''; toast('Прогресс восстановлен'); render(); window.scrollTo(0, 0);
    } else if (r.status === 404) toast('Код не найден');
    else toast('Не удалось восстановить');
  },
  async acDelete() {
    if (!confirm('Удалить аккаунт на сервере? Прогресс на этом устройстве останется, но синхронизация и восстановление перестанут работать.')) return;
    try { await api('DELETE', '/account'); } catch (e) {}
    AUTH = {}; authSave();
    await ensureAccount();
    S._v = 0; persistLocal();
    toast('Аккаунт на сервере удалён'); render();
  },
};

render();
syncInit();
