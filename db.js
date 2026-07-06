// Запись заявок в Supabase через REST API (PostgREST).
// Доступы лежат в supabase.json: { "url": "https://xxx.supabase.co", "service_role_key": "..." }
const path = require('path');
const { readJson } = require('./lib');

const CONFIG_FILE = path.join(__dirname, 'supabase.json');

async function insertPaymentRequest(row) {
  const cfg = readJson(CONFIG_FILE);
  if (!cfg) throw new Error('supabase.json не найден — нужны url и service_role_key');
  const res = await fetch(`${cfg.url}/rest/v1/payment_requests`, {
    method: 'POST',
    headers: {
      apikey: cfg.service_role_key,
      Authorization: `Bearer ${cfg.service_role_key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Supabase insert: ' + JSON.stringify(data));
  return data[0];
}

module.exports = { insertPaymentRequest };
