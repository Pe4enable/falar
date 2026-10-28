// Собирает английскую версию (для англоговорящих) в web/en/.
// Тот же код, что и русская версия, но UI и контент на английском, prompt = английский.
// Запуск: node web/build-en.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const enDir = path.join(__dirname, 'en');
const i18n = path.join(root, 'content', 'i18n', 'en');

const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const phrasesEN = J(path.join(i18n, 'phrases.json'));
const theoryEN = J(path.join(i18n, 'theory.json'));
const vocabEN = J(path.join(i18n, 'vocab.json'));
const glossaryEN = J(path.join(i18n, 'glossary.json'));
const phraseGlossEN = J(path.join(i18n, 'phrase_gloss.json'));
const ui = J(path.join(i18n, 'ui.json'));

// ---------- 1) content.js (английский) ----------
const lessonsDir = path.join(root, 'content', 'lessons');
const vocabSrc = J(path.join(root, 'content', 'vocab.json'));
const lessons = fs.readdirSync(lessonsDir).filter(f => f.endsWith('.json'))
  .map(f => J(path.join(lessonsDir, f))).sort((a, b) => a.number - b.number);

let missing = 0, glossErr = 0;
for (const l of lessons) {
  const t = theoryEN[String(l.id)];
  if (!t) { console.log('  ⚠ нет перевода теории L' + l.id); missing++; continue; }
  l.title = t.title; l.topic = t.topic;
  l.theory.intro = t.intro;
  (l.theory.blocks || []).forEach((b, i) => { if (t.blocks[i] != null) b.content = t.blocks[i]; });
  l.verbTable.translation = t.verb;
  // словарь урока: ru → english (по pt)
  l.vocab = (vocabSrc[String(l.id)] || []).map((w, i) => ({
    id: `l${l.id}v${i + 1}`, pt: w.pt, ru: vocabEN[w.pt] || w.pt
  }));
  // фразы: prompt (ru) → english; пословный перевод
  for (const p of l.phrases) {
    if (phrasesEN[p.id]) p.ru = phrasesEN[p.id]; else { console.log('  ⚠ нет перевода фразы ' + p.id); missing++; }
    if (phraseGlossEN[p.id]) {
      const g = phraseGlossEN[p.id];
      const words = p.ru.replace(/[.!?…,«»:;()]/g, ' ').split(/\s+/).filter(Boolean);
      if (g.length !== words.length) { console.log(`  ⚠ ${p.id}: gloss(${g.length}) ≠ words(${words.length}): «${p.ru}»`); glossErr++; }
      p.gloss = g;
    }
  }
}
if (missing || glossErr) { console.log(`✗ Пропуски: ${missing}, ошибки выравнивания: ${glossErr}`); process.exit(1); }

const content = 'window.FALAR_CONTENT=' + JSON.stringify({ builtAt: new Date().toISOString(), lang: 'en', lessons, glossary: glossaryEN }) + ';';
if (!fs.existsSync(enDir)) fs.mkdirSync(enDir, { recursive: true });
fs.writeFileSync(path.join(enDir, 'content.js'), content, 'utf8');

// ---------- 2) app.js (английский UI через словарь замен) ----------
let app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const keys = Object.keys(ui).sort((a, b) => b.length - a.length);  // длинные сначала
// экранируем апострофы/бэкслэши в значениях — они вставляются в строковые литералы JS
const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
for (const k of keys) app = app.split(k).join(esc(ui[k]));
app = app.split("'falar-state-v1'").join("'falar-state-en-v1'");   // отдельное хранилище прогресса
fs.writeFileSync(path.join(enDir, 'app.js'), app, 'utf8');

// контроль: осталась ли непереведённая кириллица в строковых литералах
const leftover = app.split('\n').map((line, n) => ({ line, n: n + 1 }))
  .filter(o => /["'`][^"'`]*[А-Яа-яЁё]/.test(o.line) && !o.line.trim().startsWith('//') && !o.line.trim().startsWith('*'));
if (leftover.length) {
  console.log('  ⚠ возможно непереведённые строки (' + leftover.length + '):');
  leftover.slice(0, 12).forEach(o => console.log('    L' + o.n + ': ' + o.line.trim().slice(0, 90)));
}

// ---------- 3) styles.css + icon + manifest + index.html ----------
fs.copyFileSync(path.join(__dirname, 'styles.css'), path.join(enDir, 'styles.css'));
['icon.svg', 'icon-180.png', 'icon-192.png'].forEach(f => fs.copyFileSync(path.join(__dirname, f), path.join(enDir, f)));
fs.writeFileSync(path.join(enDir, 'manifest.webmanifest'), JSON.stringify({
  name: 'Falar — European Portuguese', short_name: 'Falar', start_url: '/', scope: '/',
  display: 'standalone', orientation: 'portrait', background_color: '#FAF9F5', theme_color: '#FAF9F5', lang: 'en',
  description: 'European Portuguese — out loud from lesson one.',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
  ],
}, null, 2), 'utf8');
fs.writeFileSync(path.join(enDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#FAF9F5">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Falar — European Portuguese</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%23D97757'/%3E%3Ctext x='50' y='68' font-size='52' font-family='Georgia' font-weight='bold' fill='white' text-anchor='middle'%3EF%3C/text%3E%3C/svg%3E">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">
<script>window.FALAR_LANG='en';</script>
<script defer src="https://umami.dubkov.eu/script.js" data-website-id="0613a78e-d204-4b54-a720-eb16407a3f77" data-do-not-track="true"></script>
</head>
<body>
<div id="app"></div>
<script src="content.js"></script>
<script src="app.js"></script>
<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}</script>
</body>
</html>
`, 'utf8');

const phr = lessons.reduce((n, l) => n + l.phrases.length, 0);
console.log(`EN собрана: web/en/ · ${lessons.length} уроков, ${phr} фраз, словарь ${Object.keys(glossaryEN).length} слов`);
