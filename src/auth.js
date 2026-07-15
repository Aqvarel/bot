// Аутентификация в Microsoft: хранение токенов, автообновление по refresh_token
// и device code flow для первичного входа. Возвращает всегда действующий токен.
'use strict';
const { readJson, atomicWrite, sleep } = require('./util');

class ReauthRequiredError extends Error {
  constructor(message) { super(message); this.name = 'ReauthRequiredError'; this.code = 'REAUTH'; }
}

class Authenticator {
  #tokenPath; #clientId; #tenant; #scope; #logger; #refreshing = null;

  constructor({ tokenPath, clientId, tenant, scope, logger }) {
    this.#tokenPath = tokenPath;
    this.#clientId = clientId;
    this.#tenant = tenant;
    this.#scope = scope;
    this.#logger = logger;
  }

  #read() { return readJson(this.#tokenPath); }
  #save(data, prev = {}) {
    atomicWrite(this.#tokenPath, JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token || prev.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    }, null, 2));
  }

  // Действующий access_token; при близком истечении — обновляем. Параллельные
  // вызовы делят один запрос обновления (single-flight), чтобы не гонять refresh.
  async getAccessToken() {
    const tok = this.#read();
    if (!tok || !tok.refresh_token) {
      throw new ReauthRequiredError('нет сохранённого токена — выполните вход: node src/login.js');
    }
    if (tok.expires_at && Date.now() < tok.expires_at - 60_000) return tok.access_token;
    if (!this.#refreshing) this.#refreshing = this.#refresh(tok).finally(() => { this.#refreshing = null; });
    return this.#refreshing;
  }

  async #refresh(tok) {
    const res = await fetch(`${this.#tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.#clientId, grant_type: 'refresh_token',
        refresh_token: tok.refresh_token, scope: this.#scope,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      // invalid_grant = refresh-токен отозван/истёк → нужен повторный вход
      if (data.error === 'invalid_grant') throw new ReauthRequiredError('refresh-токен недействителен, войдите заново');
      const e = new Error('не удалось обновить токен: ' + JSON.stringify(data)); e.retryAfterMs = 3000; throw e;
    }
    this.#save(data, tok);
    this.#logger?.info('токен обновлён');
    return data.access_token;
  }

  // --- device code flow (первичный вход) ---
  async requestDeviceCode() {
    const res = await fetch(`${this.#tenant}/oauth2/v2.0/devicecode`, {
      method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.#clientId, scope: this.#scope }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return data;
  }

  async pollForToken(device) {
    const deadline = Date.now() + device.expires_in * 1000;
    while (Date.now() < deadline) {
      await sleep((device.interval || 5) * 1000);
      const res = await fetch(`${this.#tenant}/oauth2/v2.0/token`, {
        method: 'POST', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.#clientId,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: device.device_code,
        }),
      });
      const data = await res.json();
      if (res.ok) { this.#save(data); return data; }
      if (data.error === 'authorization_pending') continue;
      if (data.error === 'expired_token') break;
      throw new Error('ошибка входа: ' + JSON.stringify(data));
    }
    throw new Error('код истёк, запросите новый');
  }
}

module.exports = { Authenticator, ReauthRequiredError };
