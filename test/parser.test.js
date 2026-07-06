// Юнит-тесты разбора заявок — встроенный node:test, без зависимостей.
//   node --test
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePaymentRequest, looksLikePaymentRequest } = require('../parser');
const { matchRule } = require('../src/classify');

const TEMPLATE = `Добрый день.
Прошу направить реквизиты для оплаты .
Название курса/вебинара : ПРАКТИЧЕСКИЙ КУРС О ЗАКУПКАХ 223-ФЗ
Дата проведения (заполняется только для вебинаров): __________________
Плательщик:
Название организации: ООО «Пеннивайз»
ИНН: 7842312452
КПП: 784201234
Почтовый адрес: пеннивайз@ gmail.com
Слушатель (слушатели)**:
ФИО: Клоун Пеннивайз Убийца`;

test('распознаёт заявку по слову «реквизиты»', () => {
  assert.equal(looksLikePaymentRequest(TEMPLATE), true);
  assert.equal(looksLikePaymentRequest('обычное письмо про погоду'), false);
});

test('эталонный шаблон разбирается по всем полям', () => {
  const r = parsePaymentRequest(TEMPLATE);
  assert.equal(r.course, 'ПРАКТИЧЕСКИЙ КУРС О ЗАКУПКАХ 223-ФЗ');
  assert.equal(r.event_date, null); // прочерк => пусто
  assert.equal(r.org_name, 'ООО «Пеннивайз»'); // не «анизации:…»
  assert.equal(r.inn, '7842312452');
  assert.equal(r.kpp, '784201234');
  assert.equal(r.postal_address, 'пеннивайз@ gmail.com');
  assert.deepEqual(r.students, ['Клоун Пеннивайз Убийца']);
});

test('дата и несколько слушателей', () => {
  const r = parsePaymentRequest(TEMPLATE.replace('__________________', '15.08.2026') + '\nФИО: Иванов Иван Иванович');
  assert.equal(r.event_date, '15.08.2026');
  assert.deepEqual(r.students, ['Клоун Пеннивайз Убийца', 'Иванов Иван Иванович']);
});

test('вольный формат одной строкой', () => {
  const r = parsePaymentRequest('Выставите счёт. Организация ООО Вектор, ИНН 5047123456 КПП 504701001');
  assert.equal(r.inn, '5047123456');
  assert.equal(r.kpp, '504701001');
});

test('matchRule: тема и отправитель', () => {
  const rules = [{ name: 'partner', match: { subject_includes: ['сотрудничество'] }, reply: 'ok' }];
  assert.equal(matchRule(rules, { subject: 'Про сотрудничество', from: {} }, '').name, 'partner');
  assert.equal(matchRule(rules, { subject: 'счёт', from: {} }, ''), null);
});
