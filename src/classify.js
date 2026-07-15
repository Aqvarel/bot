/**
 * @fileoverview Сопоставляет письмо с декларативными правилами автоответа.
 */
const norm = (s) => String(s || "").toLowerCase();

// Правило срабатывает, если каждая заданная группа условий (отправитель/тема/
// текст) содержит хотя бы одно из своих слов.
/**
 * Возвращает первое правило, все заданные группы которого совпали.
 * @param {!Array<!Object>} rules Правила из конфигурации.
 * @param {!Object} msg Метаданные сообщения Microsoft Graph.
 * @param {string} bodyText Полный текст сообщения.
 * @return {?Object} Совпавшее правило или `null`.
 */
function matchRule(rules, msg, bodyText) {
  const from = norm(
    msg.from && msg.from.emailAddress && msg.from.emailAddress.address,
  );
  const subject = norm(msg.subject);
  const body = norm(bodyText);
  const hit = (list, text) => !list || list.some((w) => text.includes(norm(w)));
  return (
    (rules || []).find((r) => {
      const m = r.match || {};
      return (
        hit(m.from_includes, from) &&
        hit(m.subject_includes, subject) &&
        hit(m.body_includes, body)
      );
    }) || null
  );
}

module.exports = { matchRule };
