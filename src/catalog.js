/**
 * @fileoverview Загружает каталог курсов и сопоставляет названия из заявки.
 */
// Совпадение ТОЧНОЕ, но устойчивое к косметике: регистр, лишние пробелы,
// кавычки, ё→е, пунктуация. Поддерживает НЕСКОЛЬКО курсов в одной заявке
// (через «и» / запятую) — но так, что названия, сами содержащие «и»/запятую,
// не ломаются: ищем в тексте целые известные названия, остаток — разделители.
'use strict';
const fs = require('fs');

/**
 * Нормализует название курса для устойчивого точного сравнения.
 * @param {?string} s Исходное название.
 * @return {string} Нормализованное название.
 */
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'“”]/g, '')          // кавычки убираем
    .replace(/[.,;:!?]+/g, ' ')         // пунктуацию (в т.ч. запятые) — в пробел
    .replace(/\s+/g, ' ')
    .trim();
}

// поиск целого токена (границы — пробелы), чтобы имя не совпало внутри слова
function findToken(hay, needle) {
  let from = 0;
  while (from <= hay.length) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return -1;
    if (hay[i - 1] === ' ' && hay[i + needle.length] === ' ') return i;
    from = i + 1;
  }
  return -1;
}

/** Каталог известных курсов и цен. */
class Catalog {
  #byName = new Map();
  #items = [];
  #desc = []; // {key, item}, отсортированы по длине названия по убыванию

  /**
   * Создаёт каталог из JSON-файла.
   * @param {{pricesPath: string}} options Путь к массиву записей каталога.
   * @throws {!Error} Файл отсутствует или содержит некорректный JSON.
   */
  constructor({ pricesPath }) {
    this.#items = JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
    for (const it of this.#items) {
      const key = normName(it.name);
      this.#byName.set(key, it);
      this.#desc.push({ key, item: it });
    }
    // длинные названия матчим первыми, чтобы короткое не «съело» часть длинного
    this.#desc.sort((a, b) => b.key.length - a.key.length);
  }

  get size() { return this.#items.length; }

  // Один курс: точное (после нормализации) совпадение или null.
  /**
   * Ищет один курс по нормализованному точному названию.
   * @param {?string} courseName Название из заявки.
   * @return {?Object} Запись каталога или `null`.
   */
  lookup(courseName) {
    if (!courseName) return null;
    return this.#byName.get(normName(courseName)) || null;
  }

  // Несколько курсов из строки заявки.
  // Возвращает { items, complete }: complete=true, если РАСПОЗНАНЫ ВСЕ курсы
  // (остаток — только разделители «и»/пробелы). Если остался нераспознанный
  // текст — complete=false (заявку в HumanCheck, не угадываем).
  /**
   * Сопоставляет один или несколько курсов без частичного угадывания.
   * @param {?string} courseText Текст поля с курсами.
   * @return {{items: !Array<!Object>, complete: boolean}} Результат поиска.
   */
  match(courseText) {
    if (!courseText) return { items: [], complete: false };
    let rem = ' ' + normName(courseText) + ' ';
    const items = [];
    for (const { key, item } of this.#desc) {
      const i = findToken(rem, key);
      if (i >= 0) {
        items.push(item);
        rem = rem.slice(0, i) + ' ' + rem.slice(i + key.length); // вырезаем найденное
      }
    }
    // остаток без разделителей «и» и пробелов
    const leftover = rem.split(/\s+/).filter((w) => w && w !== 'и').join(' ');
    return { items, complete: items.length > 0 && leftover === '' };
  }
}

module.exports = { Catalog, normName };
