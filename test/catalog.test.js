// Тесты каталога цен и рендера ответа.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Catalog } = require('../src/catalog');
const { ReplyRenderer, formatPrice } = require('../src/render');

const catalog = new Catalog({ pricesPath: path.join(__dirname, '..', 'prices.json') });
const ns = (s) => s.replace(/ /g, ' '); // nbsp → обычный пробел для сравнения

test('точное совпадение находит цену', () => {
  assert.equal(catalog.lookup('Закупки по 44-ФЗ: полный базовый курс').price, 8000);
});

test('совпадение устойчиво к регистру/пробелам/кавычкам', () => {
  assert.ok(catalog.lookup('закупки по 44-фз:   полный базовый курс '));
  assert.ok(catalog.lookup('ЗАКУПКИ ПО 44-ФЗ: ПОЛНЫЙ БАЗОВЫЙ КУРС'));
});

test('не сошлось точно → null (уйдёт в HumanCheck)', () => {
  assert.equal(catalog.lookup('ПРАКТИЧЕСКИЙ КУРС О ЗАКУПКАХ ТОВАРОВ 223-ФЗ'), null);
  assert.equal(catalog.lookup(''), null);
  assert.equal(catalog.lookup(null), null);
});

test('формат цены с пробелом-разделителем', () => {
  assert.equal(ns(formatPrice(8000)), '8 000');
  assert.equal(ns(formatPrice(50000)), '50 000');
  assert.equal(ns(formatPrice(1000)), '1 000');
});

test('шаблон подставляет цену дважды и название', () => {
  const r = new ReplyRenderer({ templatePath: path.join(__dirname, '..', 'reply-template.txt') });
  const out = ns(r.render({ name: 'Закупки по 44-ФЗ: полный базовый курс', price: 8000 }));
  assert.equal((out.match(/8 000 руб\./g) || []).length, 2);
  assert.ok(out.includes('Закупки по 44-ФЗ: полный базовый курс стоит 8 000 руб.'));
  assert.ok(out.includes('univer.sberbank-ast.ru'));
});
