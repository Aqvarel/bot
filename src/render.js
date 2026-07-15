/**
 * @fileoverview Формирует текст ответа по шаблону и найденным курсам.
 */
// Один курс — вывод идентичен исходному образцу. Несколько курсов — построчная
// разбивка и суммарная стоимость для одного слушателя.
'use strict';
const fs = require('fs');

// 8000 -> "8 000" (обычный ASCII-пробел, код 32, как разделитель тысяч)
const SEP = String.fromCharCode(32);
/**
 * Форматирует целую цену с пробелами между тысячами.
 * @param {number|string} n Цена.
 * @return {string} Цена для пользовательского сообщения.
 */
function formatPrice(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, SEP);
}

/** Рендерер ответа клиенту по файловому шаблону. */
class ReplyRenderer {
  #template;
  constructor({ templatePath }) {
    this.#template = fs.readFileSync(templatePath, 'utf8');
  }

  // items = [{ name, price, term }, ...] (один или несколько курсов)
  /**
   * Подставляет разбивку и итоговую сумму в шаблон.
   * @param {!Object|!Array<!Object>} items Один курс или массив курсов.
   * @return {string} Готовый текст ответа.
   */
  render(items) {
    const list = Array.isArray(items) ? items : [items];
    const total = list.reduce((s, it) => s + it.price, 0);
    const breakdown = list
      .map((it) => `${it.name} стоит ${formatPrice(it.price)} руб.`)
      .join('\n');
    return this.#template
      .replace(/\{\{total\}\}/g, formatPrice(total))
      .replace(/\{\{breakdown\}\}/g, breakdown);
  }
}

module.exports = { ReplyRenderer, formatPrice };
