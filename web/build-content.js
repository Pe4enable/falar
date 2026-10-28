// Собирает content/lessons/*.json в web/content.js (window.FALAR_CONTENT).
// Запуск: node web/build-content.js  — перезапускать после правок уроков.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'content', 'lessons');
const lessons = fs.readdirSync(dir)
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  .sort((a, b) => a.number - b.number);

// словари уроков (content/vocab.json) — для тренажёра слов
const vocabMap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'vocab.json'), 'utf8'));
lessons.forEach(l => {
  l.vocab = (vocabMap[String(l.id)] || []).map((w, i) => ({ id: `l${l.id}v${i + 1}`, pt: w.pt, ru: w.ru }));
});

// словарь RU→PT для подсказок «тап по слову» (content/glossary.json)
const glossary = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'glossary.json'), 'utf8'));

// частотный список слов для режима «1000 слов» (content/words1000.json) — опционально
let words = [];
const wordsPath = path.join(__dirname, '..', 'content', 'words1000.json');
if (fs.existsSync(wordsPath)) {
  const raw = JSON.parse(fs.readFileSync(wordsPath, 'utf8'));
  const seen = new Set();
  for (const w of raw) {
    if (!w || !w.pt || !w.ru) continue;
    const key = String(w.pt).toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push({ pt: String(w.pt).trim(), ru: String(w.ru).trim(), pos: w.pos || 'noun' });
  }
  words = words.slice(0, 1000);   // режим «1000 слов»: берём топ-1000 по частоте (файл может содержать резерв)
}

// тренажёр форм глаголов (RU): таблица неправильных форм + частотный список
let verbs = [], verbsIrr = {};
const irrPath = path.join(__dirname, '..', 'content', 'verbs-irregular.json');
if (fs.existsSync(irrPath)) {
  const raw = JSON.parse(fs.readFileSync(irrPath, 'utf8'));
  for (const k of Object.keys(raw)) if (!k.startsWith('_')) verbsIrr[k] = raw[k];
}
const verbsPath = path.join(__dirname, '..', 'content', 'verbs.json');
if (fs.existsSync(verbsPath)) {
  const raw = JSON.parse(fs.readFileSync(verbsPath, 'utf8'));
  const seen = new Set(), excluded = [];
  for (const v of raw) {
    if (!v || !v.inf || !v.ru) continue;
    const inf = String(v.inf).trim().toLowerCase();
    if (seen.has(inf)) continue;
    seen.add(inf);
    const hasIrr = !!verbsIrr[inf];
    const regularShape = ['ar', 'er', 'ir'].includes(inf.slice(-2));
    const ruleHandled = /uzir$/.test(inf) || (/uir$/.test(inf) && !/guir$|quir$/.test(inf));   // -uzir/-uir обрабатываются правилами конъюгатора
    // включаем глагол, если он регулярный (-ar/-er/-ir, не помечен неправильным)
    // ИЛИ для него есть выверенная таблица неправильных форм ИЛИ его покрывает правило
    if (hasIrr || ruleHandled || (v.irregular === false && regularShape)) {
      verbs.push({ inf, ru: String(v.ru).trim(), irregular: hasIrr });
    } else {
      excluded.push(inf);
    }
  }
  verbs = verbs.slice(0, 300);
  if (excluded.length) console.log(`  ⚠ глаголов исключено (неправильные без таблицы форм): ${excluded.length}${excluded.length <= 50 ? ' — ' + excluded.join(', ') : ''}`);
}

// пословный перевод по фразам (content/phrase_gloss.json) — выровнен по словам RU
const phraseGloss = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'phrase_gloss.json'), 'utf8'));
let glossErrors = 0;
lessons.forEach(l => l.phrases.forEach(p => {
  const g = phraseGloss[p.id];
  if (!g) return;
  const words = p.ru.replace(/[.!?…,«»:;()]/g, ' ').split(/\s+/).filter(Boolean);
  if (g.length !== words.length) {
    console.log(`  ⚠ ${p.id}: пословный перевод (${g.length}) не совпадает со словами ru (${words.length}): «${p.ru}»`);
    glossErrors++;
  }
  p.gloss = g;
}));
if (glossErrors) { console.log(`✗ Ошибок выравнивания пословного перевода: ${glossErrors}`); process.exit(1); }

const out = 'window.FALAR_CONTENT=' + JSON.stringify({
  builtAt: new Date().toISOString(),
  lessons,
  glossary,
  words,
  verbs,
  verbsIrr
}) + ';';

fs.writeFileSync(path.join(__dirname, 'content.js'), out, 'utf8');
const phrases = lessons.reduce((n, l) => n + l.phrases.length, 0);
console.log(`content.js собран: ${lessons.length} уроков, ${phrases} фраз, ${words.length} слов, ${verbs.length} глаголов, ${(out.length / 1024).toFixed(0)} КБ`);
