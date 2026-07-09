// Каталог курсов: поиск цены по названию из заявки.
// Совпадение ТОЧНОЕ — но устойчивое к косметике: регистр, лишние пробелы,
// кавычки-ёлочки/кавычки, ё→е, висящие знаки. Если после нормализации точного
// совпадения нет — возвращаем null (письмо уйдёт в HumanCheck, цену не угадываем).
'use strict';
const fs = require('fs');

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'“”]/g, '')          // любые кавычки убираем
    .replace(/[.,;:!?]+/g, ' ')         // пунктуацию — в пробел
    .replace(/\s+/g, ' ')
    .trim();
}

class Catalog {
  #byName = new Map();
  #items = [];

  constructor({ pricesPath }) {
    this.#items = JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
    for (const it of this.#items) this.#byName.set(normName(it.name), it);
  }

  get size() { return this.#items.length; }

  // Точное (после нормализации) совпадение; иначе null.
  lookup(courseName) {
    if (!courseName) return null;
    return this.#byName.get(normName(courseName)) || null;
  }
}

module.exports = { Catalog, normName };
