// Доменная логика классификации письма: подходит ли под правило из конфига.
// Разбор заявок и детектор живут в проверенном ../parser.js (переиспользуем
const norm = (s) => String(s || "").toLowerCase();

// Правило срабатывает, если каждая заданная группа условий (отправитель/тема/
// текст) содержит хотя бы одно из своих слов.
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
