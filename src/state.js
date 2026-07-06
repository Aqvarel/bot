// Персистентное состояние поллера: отметка времени последнего обработанного
// письма (high-water-mark), множество обработанных id (идемпотентность) и
// когда кому в последний раз отвечали (антиспам-кулдаун). Запись атомарна.
'use strict';
const { readJson, atomicWrite } = require('./util');

class StateStore {
  #path; #cap; #state;

  constructor({ path, cap = 1000 }) {
    this.#path = path;
    this.#cap = cap;
    const s = readJson(path) || {};
    this.#state = {
      highWater: s.highWater || s.high_water || null, // ISO-время
      processed: Array.isArray(s.processed) ? s.processed : [],
      lastReplyTo: s.lastReplyTo || {},
    };
    this.#processedSet = new Set(this.#state.processed);
  }
  #processedSet;

  getHighWater() { return this.#state.highWater; }
  setHighWater(iso) { if (!this.#state.highWater || iso > this.#state.highWater) this.#state.highWater = iso; }

  isProcessed(id) { return this.#processedSet.has(id); }
  markProcessed(id) {
    if (this.#processedSet.has(id)) return;
    this.#processedSet.add(id);
    this.#state.processed.push(id);
    if (this.#state.processed.length > this.#cap) {
      const drop = this.#state.processed.splice(0, this.#state.processed.length - this.#cap);
      for (const d of drop) this.#processedSet.delete(d);
    }
  }

  canReply(sender, cooldownMs, now) { return now - (this.#state.lastReplyTo[sender] || 0) >= cooldownMs; }
  recordReply(sender, now) { this.#state.lastReplyTo[sender] = now; }

  async save() {
    atomicWrite(this.#path, JSON.stringify(this.#state, null, 2));
  }
}

module.exports = { StateStore };
