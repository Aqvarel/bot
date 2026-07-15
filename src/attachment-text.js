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

function extensionOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function isSupportedAttachment(attachment) {
  return attachment && attachment.isInline !== true && SUPPORTED_EXTENSIONS.has(extensionOf(attachment.name));
}

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
