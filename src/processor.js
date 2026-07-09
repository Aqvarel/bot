// Обработчик одного письма (use-case). Все зависимости внедряются — модуль
// чистый и тестируемый. Решает: пропустить / ответить по правилу / это заявка
// на оплату (разобрать → записать → ответить). Идемпотентен и антиспамен.
'use strict';
const { htmlToText, parsePaymentRequest, looksLikePaymentRequest } = require('../parser');
const { matchRule } = require('./classify');

// возможные исходы обработки — для метрик и логов
const Outcome = {
  DUP: 'dup', SELF: 'self', SKIP_SENDER: 'skip_sender', COOLDOWN: 'cooldown',
  NO_MATCH: 'no_match', RULE_REPLY: 'rule_reply',
  PAYMENT_MATCHED: 'payment_matched', PAYMENT_HUMANCHECK: 'payment_humancheck',
};

class MessageProcessor {
  #mail; #repo; #state; #config; #logger; #clock; #self;
  #catalog; #renderer; #attachment; #humanCheckFolder;
  #folderId = null;

  constructor({ mail, repo, state, config, logger, clock, selfAddress,
                catalog, renderer, attachment, humanCheckFolder }) {
    this.#mail = mail; this.#repo = repo; this.#state = state;
    this.#config = config; this.#logger = logger; this.#clock = clock; this.#self = selfAddress;
    this.#catalog = catalog; this.#renderer = renderer;
    this.#attachment = attachment; this.#humanCheckFolder = humanCheckFolder || 'HumanCheck';
  }

  async process(msg) {
    const id = msg.id;
    if (this.#state.isProcessed(id)) return Outcome.DUP;

    const from = String(msg.from && msg.from.emailAddress && msg.from.emailAddress.address || '').toLowerCase();
    const log = this.#logger.child({ msgId: id.slice(-8), from });

    // письма от себя и рассылки — пропускаем без ответа
    if (!from || (from === this.#self && !this.#config.allowSelf)) return this.#done(id, Outcome.SELF);
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
      return this.#done(id, await this.#handlePayment(id, msg, from, text, log));
    }

    const rule = matchRule(this.#config.reply.rules, msg, text);
    const reply = rule ? rule.reply : this.#config.reply.defaultReply;
    if (!reply) { log.debug('пропуск: нет подходящего правила'); return this.#done(id, Outcome.NO_MATCH); }

    await this.#reply(id, reply, from, log, rule ? rule.name : 'общий шаблон');
    return this.#done(id, Outcome.RULE_REPLY);
  }

  async #handlePayment(id, msg, from, text, log) {
    const parsed = parsePaymentRequest(text);
    const item = this.#catalog.lookup(parsed.course); // точное совпадение или null

    // Название не сошлось точно с прайсом → в HumanCheck, цену не угадываем.
    if (!item) {
      await this.#saveRow(parsed, from, msg, text, 'needs_review', null, log);
      if (this.#config.dryRun) {
        log.info('[dry-run] нет точного совпадения → HumanCheck', { course: parsed.course });
      } else {
        await this.#moveToHumanCheck(id, log);
      }
      log.info('заявка → HumanCheck (нет точного совпадения)', { course: parsed.course, org: parsed.org_name });
      return Outcome.PAYMENT_HUMANCHECK;
    }

    // Совпало → сохраняем, отвечаем заполненным шаблоном + платёжка вложением.
    await this.#saveRow(parsed, from, msg, text, 'matched', item.price, log);
    const body = this.#renderer.render(item);
    if (this.#config.dryRun) {
      log.info('[dry-run] ответил бы ценой + платёжкой', { course: item.name, price: item.price });
    } else {
      await this.#mail.replyWithAttachment(id, body, this.#attachment);
      this.#state.recordReply(from, this.#clock.now());
    }
    log.info('заявка обработана: цена + платёжка отправлены', {
      course: item.name, price: item.price, org: parsed.org_name,
      inn: parsed.inn, students: parsed.students.length, dryRun: this.#config.dryRun,
    });
    return Outcome.PAYMENT_MATCHED;
  }

  async #saveRow(parsed, from, msg, text, status, price, log) {
    if (this.#config.dryRun) return;
    const row = {
      from_email: from, subject: msg.subject || null, received_at: msg.receivedDateTime,
      ...parsed, raw_body: text, status, // price выводим из course по прайсу, отдельно не храним
    };
    try { await this.#repo.insert(row); }
    catch (e) { log.error('заявка не записана (ушла в dead-letter)', { error: e.message }); }
  }

  async #moveToHumanCheck(id, log) {
    try {
      if (!this.#folderId) this.#folderId = await this.#mail.ensureFolder(this.#humanCheckFolder);
      await this.#mail.moveToFolder(id, this.#folderId);
    } catch (e) {
      log.error('не удалось переместить в HumanCheck', { error: e.message });
    }
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
