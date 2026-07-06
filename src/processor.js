// Обработчик одного письма (use-case). Все зависимости внедряются — модуль
// чистый и тестируемый. Решает: пропустить / ответить по правилу / это заявка
// на оплату (разобрать → записать → ответить). Идемпотентен и антиспамен.
'use strict';
const { htmlToText, parsePaymentRequest, looksLikePaymentRequest } = require('../parser');
const { matchRule } = require('./classify');

// возможные исходы обработки — для метрик и логов
const Outcome = {
  DUP: 'dup', SELF: 'self', SKIP_SENDER: 'skip_sender', COOLDOWN: 'cooldown',
  NO_MATCH: 'no_match', RULE_REPLY: 'rule_reply', PAYMENT: 'payment',
};

class MessageProcessor {
  #mail; #repo; #state; #config; #logger; #clock; #self;

  constructor({ mail, repo, state, config, logger, clock, selfAddress }) {
    this.#mail = mail; this.#repo = repo; this.#state = state;
    this.#config = config; this.#logger = logger; this.#clock = clock; this.#self = selfAddress;
  }

  async process(msg) {
    const id = msg.id;
    if (this.#state.isProcessed(id)) return Outcome.DUP;

    const from = String(msg.from && msg.from.emailAddress && msg.from.emailAddress.address || '').toLowerCase();
    const log = this.#logger.child({ msgId: id.slice(-8), from });

    // письма от себя и рассылки — пропускаем без ответа
    if (!from || from === this.#self) return this.#done(id, Outcome.SELF);
    if (this.#config.skipSenders.some((w) => from.includes(w))) {
      log.debug('пропуск: рассылка/уведомление');
      return this.#done(id, Outcome.SKIP_SENDER);
    }
    // антиспам: одному отправителю не чаще кулдауна
    if (!this.#state.canReply(from, this.#config.reply.cooldownMs, this.#clock.now())) {
      log.debug('пропуск: недавно уже отвечали');
      return this.#done(id, Outcome.COOLDOWN);
    }

    // полный текст (bodyPreview обрезан — там нет ИНН/списка слушателей)
    const full = await this.#mail.getBody(id);
    const text = full.body.contentType === 'html' ? htmlToText(full.body.content) : full.body.content;

    if (looksLikePaymentRequest(text)) {
      await this.#handlePayment(id, msg, from, text, log);
      return this.#done(id, Outcome.PAYMENT);
    }

    const rule = matchRule(this.#config.reply.rules, msg, text);
    const reply = rule ? rule.reply : this.#config.reply.defaultReply;
    if (!reply) { log.debug('пропуск: нет подходящего правила'); return this.#done(id, Outcome.NO_MATCH); }

    await this.#reply(id, reply, from, log, rule ? rule.name : 'общий шаблон');
    return this.#done(id, Outcome.RULE_REPLY);
  }

  async #handlePayment(id, msg, from, text, log) {
    const parsed = parsePaymentRequest(text);
    const row = {
      from_email: from, subject: msg.subject || null, received_at: msg.receivedDateTime,
      ...parsed, raw_body: text,
    };
    let saved = false;
    if (this.#config.dryRun) {
      log.info('[dry-run] заявка на оплату', { course: parsed.course, org: parsed.org_name, inn: parsed.inn });
    } else {
      try { await this.#repo.insert(row); saved = true; }
      catch (e) { log.error('заявка не записана (ушла в dead-letter)', { error: e.message }); }
      await this.#mail.reply(id, this.#config.reply.template);
      this.#state.recordReply(from, this.#clock.now());
    }
    log.info('заявка на оплату обработана', {
      course: parsed.course, org: parsed.org_name, inn: parsed.inn, kpp: parsed.kpp,
      students: parsed.students.length, saved, dryRun: this.#config.dryRun,
    });
  }

  async #reply(id, reply, from, log, ruleName) {
    if (this.#config.dryRun) { log.info('[dry-run] ответил бы по правилу', { rule: ruleName }); return; }
    await this.#mail.reply(id, reply);
    this.#state.recordReply(from, this.#clock.now());
    log.info('автоответ отправлен', { rule: ruleName });
  }

  #done(id, outcome) { this.#state.markProcessed(id); return outcome; }
}

module.exports = { MessageProcessor, Outcome };
