// Разбор письма-заявки «прошу направить реквизиты для оплаты».
// Формат письма — построчный «Метка: значение» (эталон согласован с Денисом):
//   Название курса/вебинара : …
//   Дата проведения (только для вебинаров): …
//   Плательщик:
//   Название организации: …
//   ИНН: …   КПП: …   Почтовый адрес: …
//   Слушатель (слушатели):
//   ФИО: …

// Грубое превращение HTML-письма в плоский текст.
function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

// Нормализуем метку: нижний регистр, убираем звёздочки, схлопываем пробелы.
function norm(s) {
  return String(s).toLowerCase().replace(/[*]/g, '').replace(/\s+/g, ' ').trim();
}

// Значение считается пустым, если это прочерк/заполнитель.
function cleanVal(v) {
  v = String(v || '').trim();
  if (!v) return null;
  if (/^[_\s.·—–-]+$/.test(v)) return null; // «__________» и подобное
  return v;
}

// Разбиваем письмо на пары «метка → значение» по первому двоеточию в строке.
function toPairs(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf(':');
    if (i > 0) return { label: norm(line.slice(0, i)), value: line.slice(i + 1).trim() };
    return { label: null, value: line };
  });
}

// Несколько ФИО в одной строке — через ; или запятую перед новым именем.
function splitNames(v) {
  return String(v || '').split(/[;\n]|,(?=\s*[А-ЯЁ])/).map((s) => s.trim()).filter((s) => cleanVal(s));
}

function parsePaymentRequest(text) {
  const pairs = toPairs(text);
  // берём значение по первой подходящей метке из списка (по приоритету)
  const val = (...res) => {
    for (const re of res) {
      const p = pairs.find((x) => x.label && re.test(x.label));
      if (p) { const v = cleanVal(p.value); if (v) return v; }
    }
    return null;
  };

  // ИНН/КПП — из своей метки, иначе поиск по всему тексту
  let inn = val(/^инн/);
  if (!inn || !/^\d{10,12}$/.test(inn.replace(/\s/g, ''))) {
    const m = text.match(/инн[:\s]*?(\d{10}(?:\d{2})?)(?!\d)/i);
    inn = m ? m[1] : (inn && inn.replace(/\s/g, '')) || null;
  }
  let kpp = val(/^кпп/);
  if (!kpp || !/^\d{9}$/.test(kpp.replace(/\s/g, ''))) {
    const m = text.match(/кпп[:\s]*?(\d{9})(?!\d)/i);
    kpp = m ? m[1] : (kpp && kpp.replace(/\s/g, '')) || null;
  }

  const students = pairs
    .filter((p) => p.label && /^фио/.test(p.label))
    .flatMap((p) => splitNames(p.value));

  return {
    course: val(/^название курса/, /^курс/, /^вебинар/),
    event_date: val(/^дата проведения/),
    org_name: val(/^название организаци/, /^организаци/, /^плательщик/),
    inn: inn || null,
    kpp: kpp || null,
    postal_address: val(/^почтовый адрес/, /^адрес/),
    students,
  };
}

// Письмо похоже на заявку, если просят реквизиты/счёт или есть ИНН.
function looksLikePaymentRequest(text) {
  const low = text.toLowerCase();
  return /реквизит|счет на оплату|счёт на оплату|выставить счет|выставить счёт/.test(low)
    || /инн[:\s]*\d{10,12}/.test(low);
}

module.exports = { htmlToText, parsePaymentRequest, looksLikePaymentRequest };
