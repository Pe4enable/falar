# План: правки таблиц теории + возврат щипок-зума

**Дата:** 2026-07-05. **Исполнитель:** следующая сессия (Opus 4.8).
**Статус:** утверждён пользователем, готов к реализации.

Контекст: ревью показало, что тематические таблицы в теории уроков (поле `tables`,
генератор `content/gen-tables.js`, рендер в `vTheory` в `web/app.js`) местами дублируют
базовую схему глагола, стоят на экране раньше объясняющего текста и кое-где не привязаны
к фразам урока. Плюс решено вернуть щипок-зум, сохранив отключённый двойной тап.

Таблицы рендерятся **только в RU-версии** (`APP_LANG === 'ru'`), EN-версия меняться не должна
(кроме правки viewport — она общая).

---

## ⚠️ Критические предупреждения (прочитать до начала)

1. **`gen-tables.js` перезаписывает `l.tables` в исходниках уроков целиком** (`l.tables = TABLES[l.id]`).
   В `content/lessons/lesson07.json` есть таблица **«Два способа сказать о будущем»**, которой
   **НЕТ** в `TABLES[7]` в gen-tables.js (она была добавлена в обход генератора).
   Перед любым запуском генератора: сверить `TABLES` со **всеми 16** `lesson*.json` и перенести
   расхождения в gen-tables.js. Известное расхождение одно (L7), но проверить все.
2. **Проект не под git.** Перед запуском gen-tables.js сделать резервную копию:
   `Copy-Item -Recurse content\lessons content\lessons.bak-tables` (удалить после приёмки).
3. **Деплой (`web/deploy.ps1`) — только после явного подтверждения пользователя.** Сборка и
   локальное превью — можно без подтверждения.

---

## Задача 1. Вернуть щипок-зум, двойной тап оставить отключённым

Двойной тап отключён правилом `touch-action: manipulation` на `body` ([web/styles.css:27](web/styles.css:27)) —
**его не трогать**, оно продолжает работать.

- В `web/index.html` (строка ~5) из meta viewport убрать `, maximum-scale=1, user-scalable=no`.
  Должно остаться: `width=device-width, initial-scale=1, viewport-fit=cover`.
- В `web/build-en.js` найти шаблон EN `index.html` (heredoc с тем же meta viewport, ~строка 86)
  и сделать ту же правку, затем пересобрать EN (web/en/index.html обновится сборкой).

**Критерии:**
- [ ] В `web/index.html` и в сгенерированном `web/en/index.html` нет `user-scalable` и `maximum-scale`.
- [ ] `styles.css` не изменён.

## Задача 2. Порядок блоков на экране теории

В `web/app.js`, функция `vTheory` (~строки 1099–1101), сейчас: `${pf} ${tables} ${blocks}`.
Поменять на: `${pf} ${blocks} ${tables}` — объясняющий текст урока должен идти **до** тематических таблиц.

**Критерий:**
- [ ] В превью на теории урока 1: интро → карточка схемы глагола → чипы «по лицам» → текстовые абзацы и 💡-заметки → таблицы.

## Задача 3. Правки таблиц в `content/gen-tables.js` (объект `TABLES`)

Общий принцип: таблица не должна спрягать тот же глагол, что базовая схема урока
(`verbTable.presentFull` уже показывает его по лицам чипами прямо над таблицами),
и должна опираться на слова/фразы, реально встречающиеся в уроке.

### 3.1 Урок 1 — убрать дубль falar
Удалить paradigm-таблицу «falar — настоящее время» (дублирует чипы и текст теории).
Вместо неё — list-таблица:
```
{ type: 'list', title: 'Глаголы -ar из этого урока', cols: 2,
  note: 'Окончания -ar одни для всех: -o, -as, -a, -amos, -am. falo → trabalho → estudo.',
  items: [
    { pt: 'trabalhar', ru: 'работать' }, { pt: 'estudar', ru: 'учиться' },
    { pt: 'morar', ru: 'жить' },        { pt: 'comprar', ru: 'покупать' },
    { pt: 'tomar', ru: 'брать; пить' },
  ] }
```
(Все пять глаголов встречаются во фразах урока 1 — проверено.)

### 3.2 Урок 3 — примеры из фраз урока
Paradigm «estar — настоящее время» **оставить** (схема урока — ser, дубля нет).
В compare-таблице «ser или estar?» заменить выдуманные примеры (Sou alto / Estou cansado…)
на реальные фразы урока (дословно, с точкой):
```
rows: [
  ['профессия / состояние', 'Ela é médica.', 'Eu estou cansado.'],
  ['откуда / где сейчас',   'Eles são de Lisboa.', 'Estou em casa.'],
  ['кто по сути / где все', 'Nós somos vizinhos.', 'Nós não estamos em casa.'],
]
```
Подписи строк можно улучшить, но правая/левая ячейки — только дословные фразы урока 3.

### 3.3 Урок 4 — убрать дубль comer, поправить список
Удалить paradigm «comer — настоящее время». В списке «Частые глаголы на -er»
заменить `escrever` (в уроке не встречается) на `vender` — «продавать» (есть во фразах:
«Ela vende fruta no mercado»). В note списка добавить окончания:
`'Окончания -er: -o, -es, -e, -emos, -em.'` (перенести из note удаляемой таблицы).

### 3.4 Урок 5 — убрать дубль abrir, поправить список
Удалить paradigm «abrir — настоящее время». В списке «Частые глаголы на -ir»
убрать `ouvir` (в уроке не встречается) — остаются abrir, partir, dormir, decidir, preferir
(все пять есть во фразах). В note списка перенести окончания:
`'Окончания -ir: -o, -es, -e, -imos, -em. У dormir/preferir в «eu» меняется корень: durmo, prefiro.'`

### 3.5 Урок 7 — убрать тройной дубль ir, сохранить «Два способа»
1. **Сначала** добавить в `TABLES[7]` таблицу «Два способа сказать о будущем» —
   скопировать её объект дословно из текущего `content/lessons/lesson07.json` (поле `tables`,
   третий элемент). Иначе регенерация её удалит.
2. Удалить paradigm «ir — настоящее время» (формы ir уже в чипах схемы И в тексте теории).
   Его note («Будущее = ir (спряж.) + инфинитив…») перенести в note таблицы «Планы: ir + инфинитив».

### 3.6 Урок 9 — заменить дубль poder на сравнение трёх модальных
Удалить paradigm «poder — настоящее время». Вместо него:
```
{ type: 'contractions', title: 'poder · querer · dever — настоящее',
  cols: ['poder', 'querer', 'dever'],
  rows: ['eu', 'tu', 'ele/ela', 'nós', 'eles/elas'],
  note: 'querer — неправильный: ele quer (без -e).',
  cells: [
    ['posso', 'quero', 'devo'],
    ['podes', 'queres', 'deves'],
    ['pode', 'quer', 'deve'],
    ['podemos', 'queremos', 'devemos'],
    ['podem', 'querem', 'devem'],
  ] }
```
Список «Модальные + инфинитив» оставить без изменений.

### 3.7 Урок 8 — примеры «сейчас» из фраз урока
В compare «Просто или прямо сейчас?» левая колонка (привычное действие) остаётся модельной,
правую взять из фраз урока:
```
rows: [
  ['работать', 'Trabalho.', 'Estou a trabalhar agora.'],
  ['учить',    'Aprendo.',  'Estou a aprender português.'],
  ['спать',    'Ela dorme.', 'Ela está a dormir.'],
]
```

### 3.8 Урок 11 — убрать дубль ter
Удалить paradigm «ter — иметь». Его note («eles têm — с циркумфлексом (отличие от tem)»)
не потерять: добавить note-блок в теорию урока — в `content/lessons/lesson11.json` →
`theory.blocks` добавить `{ "type": "note", "content": "ter: tenho, tens, tem, temos, têm. eles têm — с циркумфлексом (отличие от ele tem)." }`
(теория правится в исходнике урока напрямую, генератор её не трогает).
Таблицу «Притяжательные» оставить.

### 3.9 Урок 13 — добавить таблицу прилагательных
Тема урока — «Прилагательные и указательные», но таблица есть только про указательные. Добавить ПЕРВОЙ:
```
{ type: 'contractions', title: 'Прилагательные: род и число',
  cols: ['м. ед.', 'ж. ед.', 'м. мн.', 'ж. мн.'],
  rows: ['новый', 'дорогой', 'красивый'],
  note: 'Согласование: vinho tinto, casa bonita, praias lindas. На -e и согласный род не меняют: grande, fresco → fresca, но doce = doce.',
  cells: [
    ['novo', 'nova', 'novos', 'novas'],
    ['caro', 'cara', 'caros', 'caras'],
    ['lindo', 'linda', 'lindos', 'lindas'],
  ] }
```
(novo, caro, lindas — из фраз урока.) Формулировку note можно уточнить (doce — пример без
смены формы; допустимо заменить/сократить), главное — факт «-o/-a меняется, -e не меняется».
Таблицу «Указательные по расстоянию» оставить.

### 3.10 Урок 14 — числа под задачи урока
Во фразах урока: três, oito e meia, dois euros e cinquenta, trinta e dois, quinze, nove, seis,
uma, meio-dia. Таблица «Числа 1–10» этого не покрывает. Заменить items на:
um, dois, três, quatro, cinco, seis, sete, oito, nove, dez, onze, doze, quinze, vinte,
trinta, quarenta, cinquenta, cem (cols: 2, с переводами). Обновить title: «Числа для времени и цен».
В note: `'e meia — половина: oito e meia. meio-dia — полдень. Custa dois euros e cinquenta.'`
Таблицу «Дни недели» оставить, но в note добавить употребление из фраз урока:
`'à segunda = по понедельникам (O museu não abre à segunda); na quinta-feira — в четверг.'`
(существующую note про Que horas são? / Quanto custa? сохранить или перенести в таблицу чисел).

### 3.11 Урок 15 — опорные глаголы из урока
В contractions «Pretérito Imperfeito — окончания» заменить cols `['falar','comer','partir']`
на `['morar','beber','partir']` (morar — опорный глагол схемы урока, morava и bebia есть во фразах):
```
cells: [
  ['morava', 'bebia', 'partia'],
  ['moravas', 'bebias', 'partias'],
  ['morava', 'bebia', 'partia'],
  ['morávamos', 'bebíamos', 'partíamos'],
  ['moravam', 'bebiam', 'partiam'],
]
```
Список «Неправильные в Imperfeito» оставить.

### Без изменений
Уроки 2, 6, 10, 12, 16 — таблицы в тему, не трогать. (В уроке 2 qual/quanto/porquê не встречаются
во фразах — осознанно оставляем как справку, НЕ менять.)

## Задача 4. Регенерация и сборка (строго в этом порядке)

```powershell
Copy-Item -Recurse "content\lessons" "content\lessons.bak-tables"   # бэкап (нет git!)
node content/gen-tables.js      # перезапишет lessons/*.json (должно вывести «в 16 уроков»)
node content/validate.js        # ДОЛЖНО быть 0 ошибок, иначе стоп
node web/build-content.js
node web/build-en.js            # EN: таблицы не рендерятся, но сборка должна пройти без fatal
```

## Задача 5. Проверка

### 5.1 Автопроверка (запустить, вставить вывод в отчёт)
```js
// node -e "<этот скрипт>"  (из корня проекта)
const fs=require('fs');
const get=i=>JSON.parse(fs.readFileSync('content/lessons/lesson'+String(i).padStart(2,'0')+'.json','utf8'));
let fail=0;
for(let i=1;i<=16;i++){
  const l=get(i), vt=l.verbTable||{}, pf=vt.presentFull?Object.values(vt.presentFull):[];
  for(const t of (l.tables||[])){
    if(t.type==='paradigm' && pf.includes(t.forms[0][1])){ console.log('FAIL L'+i+': таблица «'+t.title+'» дублирует схему '+vt.verb); fail++; }
  }
}
const l7=get(7);
if(!(l7.tables||[]).some(t=>/Два способа/.test(t.title))){ console.log('FAIL L7: потеряна «Два способа сказать о будущем»'); fail++; }
if(!(get(13).tables||[]).some(t=>/[Пп]рилагательн/.test(t.title))){ console.log('FAIL L13: нет таблицы прилагательных'); fail++; }
// числа урока 14 покрыты таблицей
const t14=(get(14).tables||[]).find(t=>/[Чч]исла/.test(t.title));
const need=['dois','três','seis','oito','nove','quinze','trinta','cinquenta'];
const have=t14?t14.items.map(x=>x.pt):[];
for(const n of need) if(!have.includes(n)){ console.log('FAIL L14: в таблице чисел нет '+n); fail++; }
// compare-примеры L3 дословно из фраз
const p3=get(3).phrases.map(p=>p.pt);
const c3=(get(3).tables||[]).find(t=>t.type==='compare');
for(const r of c3.rows) for(const cell of r.slice(1)) if(!p3.includes(cell)){ console.log('FAIL L3: «'+cell+'» — не фраза урока'); fail++; }
console.log(fail? 'ИТОГ: '+fail+' проблем':'ИТОГ: все проверки пройдены');
```

### 5.2 Превью (сервер `falar-web` из .claude/launch.json)
- Теория уроков 1, 3, 7, 9, 13, 14: текст идёт до таблиц; дублей спряжений нет; новые таблицы
  отображаются корректно (contractions-таблицы не переполняются по ширине на mobile 375px).
- EN-версия (`/en/`): экран теории любого урока — без таблиц, как и раньше.
- Тап по ячейкам/словам таблиц озвучивается (как до правок).

## Сводные критерии приёмки

- [ ] Автопроверка 5.1: «все проверки пройдены».
- [ ] `validate.js` — 0 ошибок; обе сборки прошли.
- [ ] Viewport: щипок-зум разрешён (нет user-scalable/maximum-scale в RU и EN index.html), `touch-action: manipulation` в styles.css на месте.
- [ ] В vTheory текстовые блоки рендерятся до таблиц.
- [ ] Ни одна paradigm-таблица не спрягает глагол базовой схемы своего урока.
- [ ] L7 «Два способа…» сохранена; note про têm не потеряна (в теории L11); окончания -er/-ir перенесены в note списков L4/L5.
- [ ] gen-tables.js и lesson*.json синхронны (повторный запуск генератора ничего не меняет).
- [ ] Превью-проверка 5.2 пройдена на mobile-вьюпорте.
- [ ] Бэкап `content/lessons.bak-tables` удалён после приёмки.
- [ ] **Деплой не выполнялся** без явного подтверждения пользователя; после подтверждения — `powershell -File web/deploy.ps1` и smoke-проверка теории урока 1 на проде.
