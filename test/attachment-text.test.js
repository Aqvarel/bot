/**
 * @fileoverview Проверяет фильтрацию и базовую валидацию вложений.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extensionOf,
  isSupportedAttachment,
  extractAttachmentText,
} = require('../src/attachment-text');

test('разрешены только PDF и DOCX без учёта регистра', () => {
  assert.equal(isSupportedAttachment({ name: 'Заявка.PDF' }), true);
  assert.equal(isSupportedAttachment({ name: 'Заявка.docx' }), true);
  assert.equal(isSupportedAttachment({ name: 'Заявка.doc' }), false);
  assert.equal(isSupportedAttachment({ name: 'Заявка.xlsx' }), false);
  assert.equal(extensionOf('Заявка.DOCX'), '.docx');
});

test('встроенные картинки не считаются заявками', () => {
  assert.equal(isSupportedAttachment({ name: 'signature.pdf', isInline: true }), false);
});

test('пустое вложение отклоняется с понятной ошибкой', async () => {
  await assert.rejects(
    extractAttachmentText({ name: 'Заявка.pdf', contentBytes: '' }),
    /пустое/,
  );
});
