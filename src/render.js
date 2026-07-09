// Формирование ответа по шаблону: подстановка цены и названия курса.
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
  // item = { name, price, term }
  render(item) {
    const price = formatPrice(item.price);
    return this.#template
      .replace(/\{\{price\}\}/g, price)
      .replace(/\{\{course\}\}/g, item.name);
  }
}

module.exports = { ReplyRenderer, formatPrice };
