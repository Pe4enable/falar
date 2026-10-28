// Добавляет тематические учебные таблицы (поле `tables`) в каждый урок.
// Европейский португальский. Запуск: node content/gen-tables.js
// Идемпотентно: перезаписывает l.tables. Только RU-версия рендерит эти таблицы.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'lessons');

const P = (eu, tu, ele, nos, eles) => ({
  type: 'paradigm', forms: [['eu', eu], ['tu', tu], ['ele/ela', ele], ['nós', nos], ['eles/elas', eles]],
});

const TABLES = {
  1: [
    { type: 'list', title: 'Глаголы -ar из этого урока', cols: 2,
      note: 'Окончания -ar одни для всех: -o, -as, -a, -amos, -am. falo → trabalho → estudo.', items: [
      { pt: 'trabalhar', ru: 'работать' }, { pt: 'estudar', ru: 'учиться' },
      { pt: 'morar', ru: 'жить' }, { pt: 'comprar', ru: 'покупать' },
      { pt: 'tomar', ru: 'брать; пить' },
    ] },
  ],
  2: [
    { type: 'list', title: 'Личные местоимения', cols: 2, items: [
      { pt: 'eu', ru: 'я' }, { pt: 'tu', ru: 'ты' }, { pt: 'ele', ru: 'он' }, { pt: 'ela', ru: 'она' },
      { pt: 'você', ru: 'Вы (вежл.)' }, { pt: 'nós', ru: 'мы' }, { pt: 'eles', ru: 'они (м.)' }, { pt: 'elas', ru: 'они (ж.)' },
    ] },
    { type: 'list', title: 'Вопросительные слова', cols: 2, note: 'porquê — «почему?»; porque — «потому что».', items: [
      { pt: 'onde?', ru: 'где?' }, { pt: 'quando?', ru: 'когда?' }, { pt: 'quem?', ru: 'кто?' },
      { pt: 'o que?', ru: 'что?' }, { pt: 'como?', ru: 'как?' }, { pt: 'porquê?', ru: 'почему?' },
      { pt: 'qual?', ru: 'какой?' }, { pt: 'quanto?', ru: 'сколько?' },
    ] },
  ],
  3: [
    { type: 'compare', title: 'ser или estar?', cols: ['ser — суть', 'estar — состояние/место'],
      note: 'ser — то, что определяет (характер, профессия, происхождение); estar — временное состояние и местонахождение.',
      rows: [
        ['профессия / состояние', 'Ela é médica.', 'Eu estou cansado.'],
        ['откуда / где сейчас', 'Eles são de Lisboa.', 'Estou em casa.'],
        ['кто по сути / где все', 'Nós somos vizinhos.', 'Nós não estamos em casa.'],
      ] },
    Object.assign({ title: 'estar — настоящее время' }, P('estou', 'estás', 'está', 'estamos', 'estão')),
  ],
  4: [
    { type: 'list', title: 'Частые глаголы на -er', cols: 2,
      note: 'Окончания -er: -o, -es, -e, -emos, -em.', items: [
      { pt: 'comer', ru: 'есть' }, { pt: 'beber', ru: 'пить' }, { pt: 'viver', ru: 'жить' },
      { pt: 'perceber', ru: 'понимать' }, { pt: 'aprender', ru: 'учить' }, { pt: 'vender', ru: 'продавать' },
    ] },
  ],
  5: [
    { type: 'list', title: 'Частые глаголы на -ir', cols: 2,
      note: 'Окончания -ir: -o, -es, -e, -imos, -em. У dormir/preferir в «eu» меняется корень: durmo, prefiro.', items: [
      { pt: 'abrir', ru: 'открывать' }, { pt: 'partir', ru: 'уезжать' }, { pt: 'dormir', ru: 'спать' },
      { pt: 'decidir', ru: 'решать' }, { pt: 'preferir', ru: 'предпочитать' },
    ] },
  ],
  6: [
    { type: 'contractions', title: 'Pretérito Perfeito — окончания', cols: ['falar', 'comer', 'partir'],
      rows: ['eu', 'tu', 'ele/ela', 'nós', 'eles/elas'],
      note: 'Завершённое действие: Ontem falei. — Вчера я поговорил.',
      cells: [
        ['falei', 'comi', 'parti'],
        ['falaste', 'comeste', 'partiste'],
        ['falou', 'comeu', 'partiu'],
        ['falámos', 'comemos', 'partimos'],
        ['falaram', 'comeram', 'partiram'],
      ] },
  ],
  7: [
    { type: 'list', title: 'Планы: ir + инфинитив', cols: 1,
      note: 'Будущее = ir (спряж.) + инфинитив: vou trabalhar — я буду работать.', items: [
      { pt: 'Vou trabalhar.', ru: 'Я буду работать.' },
      { pt: 'Vais comer?', ru: 'Ты будешь есть?' },
      { pt: 'Vamos jantar.', ru: 'Мы поужинаем.' },
    ] },
    { type: 'compare', title: 'Два способа сказать о будущем',
      cols: ['Разговорный · ir + инф.', 'Книжный · Futuro'],
      note: 'Смысл один. В речи — ir + инфинитив; синтетическое будущее (falarei) — формальнее.',
      rows: [
        ['я буду говорить', 'vou falar', 'falarei'],
        ['ты будешь есть', 'vais comer', 'comerás'],
        ['мы уедем', 'vamos partir', 'partiremos'],
      ] },
  ],
  8: [
    { type: 'compare', title: 'Просто или прямо сейчас?', cols: ['привычно', 'estar a — сейчас'],
      note: 'В евро-португальском — estar a + инфинитив (не герундий, как в Бразилии).',
      rows: [
        ['работать', 'Trabalho.', 'Estou a trabalhar agora.'],
        ['учить', 'Aprendo.', 'Estou a aprender português.'],
        ['спать', 'Ela dorme.', 'Ela está a dormir.'],
      ] },
  ],
  9: [
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
      ] },
    { type: 'list', title: 'Модальные + инфинитив', cols: 1, note: 'ter de и precisar de требуют предлог.', items: [
      { pt: 'posso falar', ru: 'я могу говорить' },
      { pt: 'quero comer', ru: 'я хочу есть' },
      { pt: 'tenho de ir', ru: 'я должен идти' },
      { pt: 'devo estudar', ru: 'мне следует учиться' },
      { pt: 'preciso de dormir', ru: 'мне нужно поспать' },
    ] },
  ],
  10: [
    { type: 'contractions', title: 'Слияния предлог + артикль', cols: ['o', 'a', 'os', 'as'],
      rows: ['em', 'de', 'a', 'por'],
      note: 'no = em + o (в); do = de + o (из/от); ao = a + o (к); pelo = por + o (через/по).',
      cells: [
        ['no', 'na', 'nos', 'nas'],
        ['do', 'da', 'dos', 'das'],
        ['ao', 'à', 'aos', 'às'],
        ['pelo', 'pela', 'pelos', 'pelas'],
      ] },
  ],
  11: [
    { type: 'compare', title: 'Притяжательные', cols: ['муж. род', 'жен. род'],
      note: 'В португальском артикль + притяжательное: o meu carro — моя машина.',
      rows: [
        ['мой', 'o meu', 'a minha'],
        ['твой', 'o teu', 'a tua'],
        ['наш', 'o nosso', 'a nossa'],
        ['ваш', 'o vosso', 'a vossa'],
      ] },
  ],
  12: [
    { type: 'list', title: 'Движение и транспорт', cols: 1,
      note: 'de + транспорт (de metro), но a pé — пешком. apanhar — сесть на (букв. поймать).', items: [
      { pt: 'ir de metro', ru: 'ехать на метро' },
      { pt: 'apanhar o autocarro', ru: 'сесть на автобус' },
      { pt: 'ir a pé', ru: 'идти пешком' },
      { pt: 'vir de comboio', ru: 'приехать на поезде' },
      { pt: 'até ao centro', ru: 'до центра' },
    ] },
  ],
  13: [
    { type: 'contractions', title: 'Прилагательные: род и число',
      cols: ['м. ед.', 'ж. ед.', 'м. мн.', 'ж. мн.'],
      rows: ['новый', 'дорогой', 'красивый'],
      note: 'Согласование: vinho tinto, casa bonita, praias lindas. На -o меняют форму (novo → nova); на -e и согласный — нет (grande, fácil одинаковы для м. и ж.).',
      cells: [
        ['novo', 'nova', 'novos', 'novas'],
        ['caro', 'cara', 'caros', 'caras'],
        ['lindo', 'linda', 'lindos', 'lindas'],
      ] },
    { type: 'contractions', title: 'Указательные по расстоянию', cols: ['муж.', 'жен.', 'нейтр.'],
      rows: ['este — тут', 'esse — у тебя', 'aquele — там'],
      note: 'gostar de: Gosto deste. — Мне нравится этот.',
      cells: [
        ['este', 'esta', 'isto'],
        ['esse', 'essa', 'isso'],
        ['aquele', 'aquela', 'aquilo'],
      ] },
  ],
  14: [
    { type: 'list', title: 'Числа для времени и цен', cols: 2,
      note: 'e meia — половина: oito e meia. meio-dia — полдень. Custa dois euros e cinquenta.', items: [
      { pt: 'um', ru: 'один' }, { pt: 'dois', ru: 'два' }, { pt: 'três', ru: 'три' }, { pt: 'quatro', ru: 'четыре' },
      { pt: 'cinco', ru: 'пять' }, { pt: 'seis', ru: 'шесть' }, { pt: 'sete', ru: 'семь' }, { pt: 'oito', ru: 'восемь' },
      { pt: 'nove', ru: 'девять' }, { pt: 'dez', ru: 'десять' }, { pt: 'onze', ru: 'одиннадцать' }, { pt: 'doze', ru: 'двенадцать' },
      { pt: 'quinze', ru: 'пятнадцать' }, { pt: 'vinte', ru: 'двадцать' }, { pt: 'trinta', ru: 'тридцать' },
      { pt: 'quarenta', ru: 'сорок' }, { pt: 'cinquenta', ru: 'пятьдесят' }, { pt: 'cem', ru: 'сто' },
    ] },
    { type: 'list', title: 'Дни недели', cols: 2,
      note: 'à segunda — по понедельникам (O museu não abre à segunda); na quinta-feira — в четверг. Que horas são? — Который час?', items: [
      { pt: 'segunda', ru: 'понедельник' }, { pt: 'terça', ru: 'вторник' }, { pt: 'quarta', ru: 'среда' },
      { pt: 'quinta', ru: 'четверг' }, { pt: 'sexta', ru: 'пятница' }, { pt: 'sábado', ru: 'суббота' },
      { pt: 'domingo', ru: 'воскресенье' },
    ] },
  ],
  15: [
    { type: 'contractions', title: 'Pretérito Imperfeito — окончания', cols: ['morar', 'beber', 'partir'],
      rows: ['eu', 'tu', 'ele/ela', 'nós', 'eles/elas'],
      note: 'Привычка/фон в прошлом: Antigamente morava em Lisboa.',
      cells: [
        ['morava', 'bebia', 'partia'],
        ['moravas', 'bebias', 'partias'],
        ['morava', 'bebia', 'partia'],
        ['morávamos', 'bebíamos', 'partíamos'],
        ['moravam', 'bebiam', 'partiam'],
      ] },
    { type: 'list', title: 'Неправильные в Imperfeito', cols: 2, note: 'Только 4 глагола неправильны в Imperfeito.', items: [
      { pt: 'era', ru: 'был (ser)' }, { pt: 'tinha', ru: 'имел (ter)' },
      { pt: 'vinha', ru: 'приходил (vir)' }, { pt: 'punha', ru: 'клал (pôr)' },
    ] },
  ],
  16: [
    { type: 'list', title: 'Фразы на каждый день', cols: 1, items: [
      { pt: 'Bom dia', ru: 'Добрый день' },
      { pt: 'Por favor', ru: 'Пожалуйста (просьба)' },
      { pt: 'Obrigado / Obrigada', ru: 'Спасибо (м. / ж.)' },
      { pt: 'Desculpe', ru: 'Извините' },
      { pt: 'A conta, por favor', ru: 'Счёт, пожалуйста' },
      { pt: 'Não percebo', ru: 'Я не понимаю' },
      { pt: 'Fala inglês?', ru: 'Вы говорите по-английски?' },
    ] },
  ],
};

let n = 0;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
  const p = path.join(dir, f);
  const l = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (TABLES[l.id]) { l.tables = TABLES[l.id]; fs.writeFileSync(p, JSON.stringify(l, null, 2) + '\n', 'utf8'); n++; }
}
console.log('Таблицы добавлены в ' + n + ' уроков.');
