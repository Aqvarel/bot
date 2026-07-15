/**
 * @fileoverview Общие файловые утилиты, задержка и retry с backoff.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * Читает и разбирает JSON, возвращая запасное значение при любой ошибке.
 * @param {string} file Путь к JSON-файлу.
 * @param {*=} fallback Значение при ошибке чтения или разбора.
 * @return {*} Разобранное содержимое или `fallback`.
 */
function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Атомарная запись: пишем во временный файл и переименовываем, чтобы при
// падении процесса не остаться с наполовину записанным state/token.
/**
 * Атомарно заменяет файл через временный файл в том же каталоге.
 * @param {string} file Целевой путь.
 * @param {string|!Buffer} data Записываемые данные.
 */
function atomicWrite(file, data) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/**
 * Добавляет JSON-объект отдельной строкой в журнал JSONL.
 * @param {string} file Путь к журналу.
 * @param {!Object} obj Записываемый объект.
 */
function appendLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + os.EOL);
}

// Ретрай с экспоненциальной задержкой и джиттером. retryable(err) решает,
// стоит ли повторять; err.retryAfterMs (из заголовка Retry-After) уважается.
/**
 * Выполняет асинхронную операцию с экспоненциальным backoff и jitter.
 * @param {function(number): !Promise<*>} fn Операция; получает номер попытки.
 * @param {!Object=} opts Настройки повторов и callback наблюдения.
 * @return {!Promise<*>} Результат успешной операции.
 * @throws {*} Последняя ошибка или ошибка, запрещённая `retryable`.
 */
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
