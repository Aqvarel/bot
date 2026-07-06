// Разбор письма «прошу направить реквизиты для оплаты».
// Письма пишут люди, формат гуляет, поэтому парсер терпимый:
// значение может стоять после метки через двоеточие или на следующей строке.

// Грубое превращение HTML-письма в плоский текст.
function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

const LABELS = [
  'название курса', 'курс',
  'плательщик', 'название орг', 'организация',
  'инн', 'кпп', 'почтовый адрес', 'адрес',
  'слушатель', 'слушатели', 'фио',
];

function isLabelLine(line) {
  const l = line.toLowerCase().replace(/[:\s]+$/, '');
  return LABELS.some((label) => l === label || l.startsWith(label + ':'));
}

// Ищет значение для метки: остаток строки после метки,
// либо следующая строка, если после метки пусто.
// Метки перебираются по порядку аргументов: первая — самая точная,
// поэтому «название орг» побеждает общий «плательщик».
function valueFor(lines, ...labels) {
  for (const label of labels) {
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      if (!low.startsWith(label)) continue;
      const rest = lines[i].slice(label.length).replace(/^[:\s—-]+/, '').trim();
      if (rest) return rest;
      for (let j = i + 1; j < lines.length; j++) {
        if (!isLabelLine(lines[j])) return lines[j];
      }
    }
  }
  return null;
}

// ФИО: 2–4 слова с заглавной буквы кириллицей, допускаем дефисы.
const FIO_RE = /^[А-ЯЁ][а-яё-]+(?: [А-ЯЁ][а-яё.-]+){1,3}$/;

function extractStudents(lines) {
  const start = lines.findIndex((l) => /^(слушател|фио)/i.test(l));
  if (start === -1) return [];
  const students = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].replace(/^(фио|слушател[а-яё]*)(\s+слушател[а-яё]*)?[:\s—-]*/i, '').trim();
    if (line && FIO_RE.test(line)) students.push(line);
  }
  return students;
}

function parsePaymentRequest(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const inn = (text.match(/инн[:\s]*(\d{10}(?:\d{2})?)(?!\d)/i) || [])[1] || null;
  const kpp = (text.match(/кпп[:\s]*(\d{9})(?!\d)/i) || [])[1] || null;
  // Если организацию написали одной строкой с ИНН/КПП — отрезаем хвост.
  let org = valueFor(lines, 'название орг', 'организация', 'плательщик');
  if (org) org = org.split(/,?\s*(?:инн|кпп)[\s:]/i)[0].trim() || org;
  return {
    course: valueFor(lines, 'название курса', 'курс'),
    org_name: org,
    inn,
    kpp,
    postal_address: valueFor(lines, 'почтовый адрес', 'адрес'),
    students: extractStudents(lines),
  };
}

// Письмо похоже на заявку, если просят реквизиты/счёт или есть ИНН.
function looksLikePaymentRequest(text) {
  const low = text.toLowerCase();
  return /реквизит|счет на оплату|счёт на оплату|выставить счет|выставить счёт/.test(low)
    || /инн[:\s]*\d{10,12}/.test(low);
}

module.exports = { htmlToText, parsePaymentRequest, looksLikePaymentRequest };
