// Загрузка и ВАЛИДАЦИЯ конфигурации при старте (fail-fast): если чего-то
// не хватает — падаем сразу с понятной ошибкой, а не посреди работы.
// Источники: app.json (настройки), supabase.json (секрет), env (переопределения).
'use strict';
const path = require('path');
const { readJson } = require('./util');

const ROOT = path.resolve(__dirname, '..');
const p = (f) => path.join(ROOT, f);

// Публичный client_id «Microsoft Graph Command Line Tools» — свой app в Azure
// личным аккаунтам недоступен. Можно переопределить через env.
const GRAPH_DEFAULTS = {
  clientId: process.env.GRAPH_CLIENT_ID || '14d82eec-204b-4c2f-b7e8-296a70dab67e',
  tenant: process.env.GRAPH_TENANT || 'https://login.microsoftonline.com/consumers',
  scope: process.env.GRAPH_SCOPE || 'Mail.ReadWrite Mail.Send User.Read offline_access',
  baseUrl: 'https://graph.microsoft.com/v1.0',
};

function fail(msg) {
  const e = new Error(`Ошибка конфигурации: ${msg}`);
  e.code = 'CONFIG';
  throw e;
}

// число из env, если задано и валидно (иначе undefined — чтобы 0 не терялся)
function envNum(name) {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
const first = (...xs) => xs.find((x) => x !== undefined && x !== null);

function load() {
  // app.json — настройки поведения (совместимо со старым rules.json)
  const app = readJson(p('app.json')) || readJson(p('rules.json')) || {};
  const s = app.settings || {};

  // supabase.json — обязательный секрет для записи заявок
  const sb = readJson(p('supabase.json'));
  if (!sb || !sb.url || !sb.service_role_key) {
    fail('нужен supabase.json с полями { "url", "service_role_key" }');
  }

  const cfg = {
    paths: {
      token: p('token.json'),
      device: p('device.json'),
      state: process.env.STATE_PATH ? path.resolve(process.env.STATE_PATH) : p('state.json'),
      health: p('health.json'),
      deadletter: p('deadletter.jsonl'),
      prices: p('prices.json'),
      template: p('reply-template.txt'),
      attachment: p('payment-order.xls'),
    },
    humanCheckFolder: process.env.HUMANCHECK_FOLDER || 'HumanCheck',
    attachmentName: 'Реквизиты для оплаты.xls',
    graph: GRAPH_DEFAULTS,
    supabase: { url: sb.url.replace(/\/$/, ''), key: sb.service_role_key, table: sb.table || 'payment_requests' },
    poll: {
      intervalMs: first(envNum('POLL_SECONDS'), s.poll_seconds, 120) * 1000,
      pageSize: envNum('POLL_PAGE_SIZE') || 50,
    },
    reply: {
      cooldownMs: first(envNum('REPLY_COOLDOWN_HOURS'), s.reply_cooldown_hours, 24) * 3600 * 1000,
      template: app.payment_request_reply || 'Ваша заявка получена. Реквизиты направим в ближайшее время.',
      rules: Array.isArray(app.rules) ? app.rules : [],
      defaultReply: app.default_reply || null,
    },
    skipSenders: (s.skip_senders || ['no-reply', 'noreply', 'donotreply', 'mailer-daemon', 'postmaster'])
      .map((x) => String(x).toLowerCase()),
    dryRun: process.env.DRY_RUN === '1',
    allowSelf: process.env.TEST_ALLOW_SELF === '1', // только для контролируемых тестов
    processedCap: 1000,
  };

  if (cfg.poll.intervalMs < 15000) fail('интервал опроса слишком мал (мин. 15 c)');
  return cfg;
}

module.exports = { load };
