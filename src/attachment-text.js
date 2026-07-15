/**
 * @fileoverview Проверяет вложения заявок и извлекает текст из PDF/DOCX.
 */
'use strict';

const path = require('path');

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx']);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 20_000;

function withParseTimeout(promise, name) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`превышено время разбора ${name}`)),
      PARSE_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Возвращает нормализованное расширение имени файла.
 * @param {?string} name Имя файла.
 * @return {string} Расширение в нижнем регистре с ведущей точкой.
 */
function extensionOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

/**
 * Проверяет, является ли вложение поддерживаемым пользовательским документом.
 * @param {?Object} attachment Метаданные вложения Microsoft Graph.
 * @return {boolean} `true` для невстроенного PDF или DOCX.
 */
function isSupportedAttachment(attachment) {
  return attachment && attachment.isInline !== true && SUPPORTED_EXTENSIONS.has(extensionOf(attachment.name));
}

/**
 * Извлекает текст из PDF или DOCX с проверкой размера и сигнатуры.
 * @param {!Object} attachment Вложение с `name` и base64-полем `contentBytes`.
 * @return {!Promise<string>} Извлечённый нормализованный текст.
 * @throws {!Error} Файл пуст, слишком велик, повреждён или не поддерживается.
 */
async function extractAttachmentText(attachment) {
  const ext = extensionOf(attachment.name);
  const buffer = Buffer.from(attachment.contentBytes || '', 'base64');
  if (!buffer.length) throw new Error(`вложение ${attachment.name} пустое`);
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`вложение ${attachment.name} больше 10 МБ`);
  }

  if (ext === '.pdf') {
    if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error(`${attachment.name} не является PDF`);
    }
    const pdf = require('pdf-parse');
    const result = await withParseTimeout(pdf(buffer), attachment.name);
    return String(result.text || '').trim();
  }

  if (ext === '.docx') {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new Error(`${attachment.name} не является DOCX`);
    }
    const mammoth = require('mammoth');
    const result = await withParseTimeout(mammoth.extractRawText({ buffer }), attachment.name);
    return String(result.value || '').trim();
  }

  throw new Error(`неподдерживаемый формат вложения: ${ext || 'без расширения'}`);
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  extensionOf,
  isSupportedAttachment,
  extractAttachmentText,
};
