/**
 * @fileoverview Проверяет каталог цен и формирование ответа клиенту.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Catalog } = require('../src/catalog');
const { ReplyRenderer, formatPrice } = require('../src/render');

const catalog = new Catalog({ pricesPath: path.join(__dirname, '..', 'prices.json') });
const ns = (s) => s.replace(/ /g, ' '); // nbsp → обычный пробел

test('один курс: точное совпадение находит цену', () => {
  assert.equal(catalog.lookup('Закупки по 44-ФЗ: полный базовый курс').price, 8000);
});

test('совпадение устойчиво к регистру/пробелам/кавычкам', () => {
  assert.ok(catalog.lookup('закупки по 44-фз:   полный базовый курс '));
  assert.ok(catalog.lookup('ЗАКУПКИ ПО 44-ФЗ: ПОЛНЫЙ БАЗОВЫЙ КУРС'));
});

test('match: один курс → complete, один item', () => {
  const r = catalog.match('Закупки по 44-ФЗ: полный базовый курс');
  assert.equal(r.complete, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].price, 8000);
});

test('match: два курса через «и» → оба распознаны', () => {
  const r = catalog.match('Закупки по 44-ФЗ: полный базовый курс и Способы закупок по 223-ФЗ');
  assert.equal(r.complete, true);
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items.map((i) => i.price).sort(), [1000, 8000]);
});

test('match: два курса через запятую', () => {
  const r = catalog.match('Способы закупок по 223-ФЗ, Электронный запрос котировок');
  assert.equal(r.complete, true);
  assert.equal(r.items.length, 2);
});

test('match: название с внутренним «и» не ломается', () => {
  const r = catalog.match('Цифровые решения для бизнеса и государства: от идеи до реализации');
  assert.equal(r.complete, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].price, 9700);
});

test('match: неизвестный курс → complete=false (HumanCheck)', () => {
  assert.equal(catalog.match('Какой-то левый курс 999').complete, false);
  assert.equal(catalog.match('Способы закупок по 223-ФЗ и Неизвестный курс').complete, false);
  assert.equal(catalog.match('').complete, false);
});

test('формат цены с пробелом-разделителем', () => {
  assert.equal(ns(formatPrice(8000)), '8 000');
  assert.equal(ns(formatPrice(50000)), '50 000');
});

test('рендер: один курс — вывод как в образце', () => {
  const r = new ReplyRenderer({ templatePath: path.join(__dirname, '..', 'reply-template.txt') });
  const out = ns(r.render([{ name: 'Закупки по 44-ФЗ: полный базовый курс', price: 8000 }]));
  assert.ok(out.includes('Стоимость для 1 слушателя: 8 000 руб.'));
  assert.ok(out.includes('Закупки по 44-ФЗ: полный базовый курс стоит 8 000 руб.'));
});

test('рендер: несколько курсов — сумма и разбивка', () => {
  const r = new ReplyRenderer({ templatePath: path.join(__dirname, '..', 'reply-template.txt') });
  const out = ns(r.render([
    { name: 'Закупки по 44-ФЗ: полный базовый курс', price: 8000 },
    { name: 'Способы закупок по 223-ФЗ', price: 1000 },
  ]));
  assert.ok(out.includes('Стоимость для 1 слушателя: 9 000 руб.')); // сумма
  assert.ok(out.includes('Закупки по 44-ФЗ: полный базовый курс стоит 8 000 руб.'));
  assert.ok(out.includes('Способы закупок по 223-ФЗ стоит 1 000 руб.'));
});
