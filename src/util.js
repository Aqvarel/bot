// Мелкие переиспользуемые утилиты: сон, атомарная запись файла, чтение JSON,
// ретрай с экспоненциальным backoff. Без внешних зависимостей.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Атомарная запись: пишем во временный файл и переименовываем, чтобы при
// падении процесса не остаться с наполовину записанным state/token.
function atomicWrite(file, data) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function appendLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + os.EOL);
}

// Ретрай с экспоненциальной задержкой и джиттером. retryable(err) решает,
// стоит ли повторять; err.retryAfterMs (из заголовка Retry-After) уважается.
async function withRetry(fn, opts = {}) {
  const { retries = 4, baseMs = 500, maxMs = 20000, factor = 2, retryable = () => true, onRetry } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !retryable(err)) throw err;
      let delay = Math.min(maxMs, baseMs * factor ** attempt);
      if (err && err.retryAfterMs) delay = Math.max(delay, err.retryAfterMs);
      delay = Math.round(delay * (0.5 + Math.random())); // джиттер 0.5–1.5×
      if (onRetry) onRetry(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
}

module.exports = { sleep, readJson, atomicWrite, appendLine, withRetry };
