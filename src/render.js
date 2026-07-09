// Формирование ответа по шаблону: подстановка цены(цен) и названия(й) курса.
// Один курс — вывод идентичен исходному образцу. Несколько курсов — построчная
// разбивка и суммарная стоимость для одного слушателя.
'use strict';
const fs = require('fs');

// 8000 -> "8 000" (обычный ASCII-пробел, код 32, как разделитель тысяч)
const SEP = String.fromCharCode(32);
function formatPrice(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, SEP);
}

class ReplyRenderer {
  #template;
  constructor({ templatePath }) {
    this.#template = fs.readFileSync(templatePath, 'utf8');
  }

  // items = [{ name, price, term }, ...] (один или несколько курсов)
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
