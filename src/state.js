/**
 * @fileoverview Хранит cursor, идемпотентность и cooldown почтового poller.
 */
// Персистентное состояние поллера: отметка времени последнего обработанного
// письма (high-water-mark), множество обработанных id (идемпотентность) и
// когда кому в последний раз отвечали (антиспам-кулдаун). Запись атомарна.
'use strict';
const { readJson, atomicWrite } = require('./util');

/** Файловое состояние обработки сообщений с опциональной персистентностью. */
class StateStore {
  #path; #cap; #state; #persist;

  /**
   * Создаёт store и загружает существующее состояние.
   * @param {{path: string, cap: (number|undefined),
   *   persist: (boolean|undefined)}} options Настройки состояния.
   */
  constructor({ path, cap = 1000, persist = true }) {
    this.#path = path;
    this.#cap = cap;
    this.#persist = persist;
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

  /**
   * Проверяет, разрешён ли автоответ отправителю по cooldown.
   * @param {string} sender Нормализованный email.
   * @param {number} cooldownMs Интервал ограничения.
   * @param {number} now Текущее Unix-время в миллисекундах.
   * @return {boolean} Разрешение на автоответ.
   */
  canReply(sender, cooldownMs, now) { return now - (this.#state.lastReplyTo[sender] || 0) >= cooldownMs; }
  recordReply(sender, now) { this.#state.lastReplyTo[sender] = now; }

  /**
   * Сохраняет состояние атомарно, если включена персистентность.
   * @return {!Promise<void>}
   */
  async save() {
    if (!this.#persist) return;
    atomicWrite(this.#path, JSON.stringify(this.#state, null, 2));
  }
}

module.exports = { StateStore };
