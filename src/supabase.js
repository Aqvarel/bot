// Репозиторий заявок в Supabase (PostgREST) с ретраями. Если база недоступна
// после всех повторов — заявка не теряется, а падает в dead-letter журнал,
// чтобы её можно было доотправить руками.
'use strict';
const { withRetry, appendLine } = require('./util');

const isTransient = (err) => !err.status || (err.status >= 500 && err.status < 600) || err.status === 429;

class PaymentRepo {
  #url; #key; #table; #deadletter; #logger;

  constructor({ url, key, table, deadletterPath, logger }) {
    this.#url = url; this.#key = key; this.#table = table;
    this.#deadletter = deadletterPath; this.#logger = logger;
  }

  async insert(row) {
    try {
      return await withRetry(() => this.#post(row), {
        retryable: isTransient,
        onRetry: (e, a, d) => this.#logger?.warn('повтор записи в Supabase', { attempt: a, delayMs: d, status: e.status }),
      });
    } catch (err) {
      // dead-letter: сохраняем заявку локально, чтобы ничего не потерять
      appendLine(this.#deadletter, { at: new Date().toISOString(), error: err.message, row });
      this.#logger?.error('запись в базу не удалась — заявка в dead-letter', { error: err.message });
      throw err;
    }
  }

  async #post(row) {
    const endpoint = `${this.#url}/rest/v1/${this.#table}?on_conflict=source_message_id`;
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        apikey: this.#key, Authorization: `Bearer ${this.#key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const e = new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`); e.status = res.status; throw e;
    }
    const data = await res.json();
    return data[0] || null; // null = это письмо уже было записано
  }
}

module.exports = { PaymentRepo };
