// Общие константы и помощники для почтового бота.
// Используем публичный client ID "Microsoft Graph Command Line Tools" —
// свой регистрировать не нужно (у личных аккаунтов нет доступа к Azure-порталу).
const fs = require('fs');
const path = require('path');

const CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e';
const TENANT = 'https://login.microsoftonline.com/consumers';
const SCOPE = 'Mail.ReadWrite Mail.Send User.Read offline_access';
const GRAPH = 'https://graph.microsoft.com/v1.0';

const TOKEN_FILE = path.join(__dirname, 'token.json');
const DEVICE_FILE = path.join(__dirname, 'device.json');

// Уведомления пишутся в лог рядом с ботом (notifications.log).
const LOG_FILE = path.join(__dirname, 'notifications.log');

async function notify(text) {
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${text}\n\n`);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Возвращает действующий access_token, при необходимости обновляя его
// по refresh_token. Бросает ошибку, если токена нет — тогда нужен login.
async function getAccessToken() {
  const tok = readJson(TOKEN_FILE);
  if (!tok) throw new Error('token.json не найден — сначала пройди вход (node login.js request)');
  if (tok.expires_at && Date.now() < tok.expires_at - 60_000) return tok.access_token;

  const res = await fetch(`${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: tok.refresh_token,
      scope: SCOPE,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('не удалось обновить токен: ' + JSON.stringify(data));
  saveToken(data, tok);
  return data.access_token;
}

function saveToken(data, prev = {}) {
  writeJson(TOKEN_FILE, {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prev.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });
}

// Запрос к Microsoft Graph с готовым токеном.
async function graph(method, url, body) {
  const token = await getAccessToken();
  const res = await fetch(GRAPH + url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 202 || res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(`Graph ${method} ${url}: ${JSON.stringify(data)}`);
  return data;
}

module.exports = {
  CLIENT_ID, TENANT, SCOPE, GRAPH,
  TOKEN_FILE, DEVICE_FILE,
  notify, readJson, writeJson, getAccessToken, saveToken, graph,
};
