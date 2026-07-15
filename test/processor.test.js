/**
 * @fileoverview Проверяет критические сценарии обработки одного сообщения.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageProcessor, Outcome } = require('../src/processor');

const APPLICATION = `Прошу направить реквизиты для оплаты.
Название курса: Тестовый курс
Название организации: ООО Тест
ИНН: 1234567890
КПП: 123456789
ФИО: Иванов Иван Иванович`;

const logger = {
  child() { return this; }, debug() {}, info() {}, warn() {}, error() {},
};

function fixture(body, canReply = false) {
  const calls = { rows: [], replies: 0, processed: [] };
  const mail = {
    async getBody() { return { body: { contentType: 'text', content: body } }; },
    async listAttachments() { return []; },
    async replyWithAttachment() { calls.replies++; },
    async reply() { calls.replies++; },
  };
  const state = {
    isProcessed: () => false,
    canReply: () => canReply,
    recordReply() {},
    markProcessed(id) { calls.processed.push(id); },
  };
  const processor = new MessageProcessor({
    mail,
    repo: { async insert(row) { calls.rows.push(row); } },
    state,
    config: {
      allowSelf: false, skipSenders: [], dryRun: false,
      reply: { cooldownMs: 86_400_000, rules: [], defaultReply: null },
    },
    logger,
    clock: { now: () => 1_000_000 },
    selfAddress: 'bot@example.com',
    catalog: {
      match: (name) => name === 'Тестовый курс'
        ? { complete: true, items: [{ name, price: 1000 }] }
        : { complete: false, items: [] },
    },
    renderer: { render: () => 'Ответ' },
    attachment: { name: 'payment.xls', contentBytes: 'AA==' },
  });
  return { processor, calls };
}

const message = {
  id: 'graph-message-1', subject: 'Заявка', receivedDateTime: '2026-07-15T10:00:00Z',
  from: { emailAddress: { address: 'client@example.com' } },
};

test('обычная текстовая заявка обрабатывается без вложения', async () => {
  const { processor, calls } = fixture(APPLICATION, true);
  assert.equal(await processor.process(message), Outcome.PAYMENT_MATCHED);
  assert.equal(calls.rows.length, 1);
  assert.equal(calls.rows[0].source_message_id, message.id);
  assert.equal(calls.replies, 1);
});

test('кулдаун не отбрасывает повторную настоящую заявку', async () => {
  const { processor, calls } = fixture(APPLICATION, false);
  assert.equal(await processor.process(message), Outcome.PAYMENT_MATCHED);
  assert.equal(calls.rows.length, 1);
  assert.equal(calls.replies, 1);
});
