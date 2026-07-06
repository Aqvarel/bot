// Структурный логгер с уровнями и контекстом. Формат управляется LOG_FORMAT
// (pretty|json) и LOG_LEVEL (debug|info|warn|error). child() привязывает
// постоянные поля (например, id письма) ко всем последующим записям.
'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

function createLogger(opts = {}) {
  const level = opts.level || process.env.LOG_LEVEL || 'info';
  const format = opts.format || process.env.LOG_FORMAT || 'pretty';
  const base = opts.base || {};
  const min = LEVELS[level] ?? LEVELS.info;

  function emit(lvl, msg, ctx) {
    if ((LEVELS[lvl] ?? 20) < min) return;
    const time = new Date().toISOString();
    const fields = { ...base, ...(ctx || {}) };
    if (format === 'json') {
      process.stdout.write(JSON.stringify({ time, level: lvl, msg, ...fields }) + '\n');
    } else {
      const extra = Object.keys(fields).length ? ' ' + JSON.stringify(fields) : '';
      process.stdout.write(`${COLORS[lvl] || ''}${lvl.toUpperCase().padEnd(5)}${RESET} ${time}  ${msg}${extra}\n`);
    }
  }

  return {
    debug: (m, c) => emit('debug', m, c),
    info: (m, c) => emit('info', m, c),
    warn: (m, c) => emit('warn', m, c),
    error: (m, c) => emit('error', m, c),
    child: (extra) => createLogger({ level, format, base: { ...base, ...extra } }),
  };
}

module.exports = { createLogger };
