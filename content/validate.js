// Валидатор контента уроков. Запуск: node content/validate.js
// Проверяет: JSON парсится; id уникальны и по формату; обязательные поля;
// длина фразы 2–8 плиток; дистракторы не совпадают со словами фразы.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'lessons');
const TENSES = ['present', 'past', 'future', 'continuous', 'imperfect', 'mixed'];
const FORMS = ['affirm', 'negate', 'question'];
const CONJ = ['ar', 'er', 'ir', 'irregular', 'mixed', 'n/a'];

const allIds = new Set();
let totalPhrases = 0;
let allOk = true;

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
for (const f of files) {
  const errs = [];
  let d;
  try {
    d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  } catch (e) {
    console.log(`${f}  ПАРСИНГ СЛОМАН: ${e.message}`);
    allOk = false;
    continue;
  }
  for (const k of ['id', 'number', 'title', 'topic', 'theory', 'verbTable', 'phrases', 'exam'])
    if (d[k] === undefined) errs.push(`нет поля ${k}`);
  if (typeof d.free !== 'boolean') errs.push('нет флага free');

  for (const p of d.phrases || []) {
    if (allIds.has(p.id)) errs.push(`дубль id ${p.id}`);
    allIds.add(p.id);
    if (!new RegExp(`^l${d.id}-\\d{3}$`).test(p.id)) errs.push(`id не по формату: ${p.id}`);
    for (const k of ['ru', 'pt', 'tense', 'form', 'conjugation'])
      if (!p[k]) errs.push(`${p.id}: нет ${k}`);
    if (p.tense && !TENSES.includes(p.tense)) errs.push(`${p.id}: tense=${p.tense}`);
    if (p.form && !FORMS.includes(p.form)) errs.push(`${p.id}: form=${p.form}`);
    if (p.conjugation && !CONJ.includes(p.conjugation)) errs.push(`${p.id}: conjugation=${p.conjugation}`);

    const tiles = (p.pt || '').replace(/[.!?…,«»:;]/g, '').trim().split(/\s+/);
    if (tiles.length < 2 || tiles.length > 8) errs.push(`${p.id}: плиток ${tiles.length} (надо 2–8)`);
    const lower = tiles.map(w => w.toLowerCase());

    if (!Array.isArray(p.distractors) || p.distractors.length < 1) {
      errs.push(`${p.id}: нет дистракторов`);
    } else {
      for (const dd of p.distractors)
        if (lower.includes(dd.toLowerCase())) errs.push(`${p.id}: дистрактор «${dd}» совпадает со словом фразы`);
    }
  }
  totalPhrases += (d.phrases || []).length;
  console.log(`${f}  фраз: ${(d.phrases || []).length}  free: ${d.free}  ${errs.length ? 'ОШИБКИ: ' + errs.join('; ') : 'OK'}`);
  if (errs.length) allOk = false;
}
console.log(`\nИтого: ${files.length} уроков, ${totalPhrases} фраз. ${allOk ? '✓ Всё чисто.' : '✗ Есть ошибки — исправь и перезапусти.'}`);
process.exit(allOk ? 0 : 1);
