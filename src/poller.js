// Поллер: цикл «забрать новые письма → обработать → продвинуть high-water →
// сохранить состояние → health → пауза». Поддерживает мягкую остановку.
'use strict';
const { sleep } = require('./util');

class Poller {
  #mail; #state; #processor; #config; #logger; #clock;
  #running = false; #wake = null;

  constructor({ mail, state, processor, config, logger, clock }) {
    this.#mail = mail; this.#state = state; this.#processor = processor;
    this.#config = config; this.#logger = logger; this.#clock = clock;
  }

  async start() {
    this.#running = true;
    // первый запуск: начинаем с текущего момента, чтобы не отвечать на весь архив
    if (!this.#state.getHighWater()) {
      this.#state.setHighWater(new Date(this.#clock.now()).toISOString());
      await this.#state.save();
      this.#logger.info('первый запуск — стартуем с текущего момента');
    }
    this.#logger.info('поллер запущен', { intervalMs: this.#config.poll.intervalMs, dryRun: this.#config.dryRun });

    while (this.#running) {
      const started = this.#clock.now();
      try {
        await this.#cycle();
      } catch (err) {
        if (err.code === 'REAUTH') this.#logger.error('нужен повторный вход — бот ждёт', { error: err.message });
        else this.#logger.error('ошибка цикла', { error: err.message });
        this.#writeHealth({ ok: false, error: err.message });
      }
      await this.#sleepInterruptible(this.#config.poll.intervalMs - (this.#clock.now() - started));
    }
    this.#logger.info('поллер остановлен');
  }

  async #cycle() {
    const since = this.#state.getHighWater();
    const messages = await this.#mail.fetchSince(since, this.#config.poll.pageSize);
    const counts = {};
    for (const m of messages) {
      const outcome = await this.#processor.process(m);
      counts[outcome] = (counts[outcome] || 0) + 1;
      this.#state.setHighWater(m.receivedDateTime); // продвигаем отметку времени
    }
    await this.#state.save();
    this.#writeHealth({ ok: true, fetched: messages.length, counts });
    if (messages.length) this.#logger.info('цикл завершён', { fetched: messages.length, ...counts });
    else this.#logger.debug('цикл: новых писем нет');
  }

  // health-файл для внешнего мониторинга (systemd/cron может его проверять)
  #writeHealth(extra) {
    try {
      require('fs').writeFileSync(this.#config.paths.health,
        JSON.stringify({ lastCycleAt: new Date(this.#clock.now()).toISOString(), ...extra }, null, 2));
    } catch { /* health не критичен */ }
  }

  stop() { this.#running = false; if (this.#wake) this.#wake(); }

  // прерываемая пауза: stop() будит немедленно, не дожидаясь конца интервала
  #sleepInterruptible(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, Math.max(0, ms));
      this.#wake = () => { clearTimeout(t); resolve(); };
    });
  }
}

module.exports = { Poller };
