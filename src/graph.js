// Шлюз Microsoft Graph: HTTP-клиент с авторизацией, ретраями и уважением к
// троттлингу (429 Retry-After), плюс доменные операции с почтой.
'use strict';
const { withRetry } = require('./util');

class GraphError extends Error {
  constructor(message, status, retryAfterMs) {
    super(message); this.name = 'GraphError'; this.status = status; this.retryAfterMs = retryAfterMs;
  }
}

// повторяем сетевые сбои, 429 и 5xx; не повторяем 4xx (кроме 429)
const isTransient = (err) => !err.status || err.status === 429 || (err.status >= 500 && err.status < 600);

class GraphClient {
  #auth; #baseUrl; #logger;
  constructor({ auth, baseUrl, logger }) { this.#auth = auth; this.#baseUrl = baseUrl; this.#logger = logger; }

  async request(method, urlOrPath, body) {
    const url = urlOrPath.startsWith('http') ? urlOrPath : this.#baseUrl + urlOrPath;
    return withRetry(async () => {
      const token = await this.#auth.getAccessToken();
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 202 || res.status === 204) return null;
      if (!res.ok) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const text = await res.text().catch(() => '');
        throw new GraphError(`${method} ${url} → ${res.status} ${text.slice(0, 300)}`,
          res.status, retryAfter ? retryAfter * 1000 : undefined);
      }
      return res.json();
    }, {
      retryable: isTransient,
      onRetry: (err, attempt, delay) =>
        this.#logger?.warn('повтор запроса Graph', { attempt, delayMs: delay, status: err.status }),
    });
  }

  get(p) { return this.request('GET', p); }
  post(p, b) { return this.request('POST', p, b); }
  patch(p, b) { return this.request('PATCH', p, b); }
}

class MailService {
  #client;
  constructor({ client }) { this.#client = client; }

  async whoAmI() {
    const me = await this.#client.get('/me');
    return (me.userPrincipalName || me.mail || '').toLowerCase();
  }

  // Все письма, пришедшие начиная с isoTime (включительно), по возрастанию —
  // независимо от статуса прочтения. Это чинит баг «письмо открыли раньше бота».
  async fetchSince(isoTime, pageSize = 50) {
    const params = new URLSearchParams({
      '$filter': `receivedDateTime ge ${isoTime}`,
      '$orderby': 'receivedDateTime asc',
      '$top': String(pageSize),
      '$select': 'id,subject,from,bodyPreview,receivedDateTime,isRead',
    });
    let path = `/me/mailFolders/inbox/messages?${params}`;
    const out = [];
    while (path) {
      const data = await this.#client.get(path);
      out.push(...(data.value || []));
      path = data['@odata.nextLink'] || null; // nextLink абсолютный — клиент это учитывает
    }
    return out;
  }

  getBody(id) { return this.#client.get(`/me/messages/${id}?$select=body,subject,from`); }
  reply(id, comment) { return this.#client.post(`/me/messages/${id}/reply`, { comment }); }
  markRead(id) { return this.#client.patch(`/me/messages/${id}`, { isRead: true }); }
}

module.exports = { GraphClient, MailService, GraphError };
