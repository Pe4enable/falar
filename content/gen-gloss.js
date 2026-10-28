// Генерирует пословный перевод (phrase_gloss) детерминированно из словаря.
// Гарантирует выравнивание (длина = число слов) и отсутствие кириллицы в PT.
// Артикль (o/a/os/as) подтягивается из самой PT-фразы.
// Запуск: node content/gen-gloss.js
const fs = require('fs');
const path = require('path');
const root = __dirname;

const tokenize = s => s.replace(/[.!?…,«»:;()]/g, ' ').split(/\s+/).filter(Boolean);
const ptWords = pt => pt.replace(/[.!?…,«»:;]/g, '').trim().split(/\s+/).filter(Boolean);
const ARTICLES = new Set(['o', 'a', 'os', 'as']);

function genFor(promptText, pt, glossary) {
  const toks = tokenize(promptText);
  const pw = ptWords(pt);
  return toks.map(tok => {
    const w = tok.toLowerCase();
    let v = glossary[w];
    if (v == null) v = glossary[w.replace(/ё/g, 'е')];
    if (v == null) v = '';
    // подтянуть голый артикль, если PT-слово стоит в фразе после o/a/os/as
    if (v && !v.includes(' ')) {
      const i = pw.findIndex(x => x.toLowerCase() === v.toLowerCase());
      if (i > 0 && ARTICLES.has(pw[i - 1].toLowerCase())) v = pw[i - 1] + ' ' + v;
    }
    return v;
  });
}

const lessons = fs.readdirSync(path.join(root, 'lessons')).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(root, 'lessons', f), 'utf8'))).sort((a, b) => a.number - b.number);

function build(lang, glossary, promptOf, outPath) {
  const out = { _note: `Пословный перевод (${lang}), сгенерирован gen-gloss.js: выровнен по словам, артикли из PT-фразы.` };
  let empties = 0, total = 0;
  for (const l of lessons) for (const p of l.phrases) {
    const g = genFor(promptOf(p), p.pt, glossary);
    out[p.id] = g;
    g.forEach(v => { total++; if (!v) empties++; });
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 0).replace(/\],/g, '],\n ').replace(/\{/, '{\n ') , 'utf8');
  console.log(`${lang}: ${Object.keys(out).length - 1} фраз → ${outPath.split(/[\\/]/).pop()} · пустых слов: ${empties}/${total}`);
}

// RU
const glossRu = JSON.parse(fs.readFileSync(path.join(root, 'glossary.json'), 'utf8'));
build('ru', glossRu, p => p.ru, path.join(root, 'phrase_gloss.json'));

// EN
const glossEn = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'en', 'glossary.json'), 'utf8'));
const phrasesEn = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'en', 'phrases.json'), 'utf8'));
build('en', glossEn, p => phrasesEn[p.id] || p.ru, path.join(root, 'i18n', 'en', 'phrase_gloss.json'));
