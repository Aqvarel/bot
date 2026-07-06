// Почтовый автоответчик: раз в poll_seconds проверяет входящие,
// подбирает шаблон по правилам из rules.json и отвечает.
//
//   node bot.js        — работать постоянно
//   node bot.js once   — один проход (для проверки)
const path = require("path");
const { graph, notify, readJson, writeJson } = require("./lib");
const {
  htmlToText,
  parsePaymentRequest,
  looksLikePaymentRequest,
} = require("./parser");
const { insertPaymentRequest } = require("./db");

const RULES_FILE = path.join(__dirname, "rules.json");
const STATE_FILE = path.join(__dirname, "state.json");

const norm = (s) => (s || "").toLowerCase();

// Письмо подходит под правило, если каждая заданная группа условий
// (отправитель / тема / текст) содержит хотя бы одно из своих слов.
function matches(rule, msg) {
  const m = rule.match || {};
  const from = norm(msg.from?.emailAddress?.address);
  const subject = norm(msg.subject);
  const body = norm(msg.bodyPreview);
  const hit = (list, text) => !list || list.some((w) => text.includes(norm(w)));
  return (
    hit(m.from_includes, from) &&
    hit(m.subject_includes, subject) &&
    hit(m.body_includes, body)
  );
}

async function checkOnce() {
  const cfg = readJson(RULES_FILE);
  const state = readJson(STATE_FILE, { processed: [], lastReplyTo: {} });
  const me =
    state.me ||
    (state.me = (await graph("GET", "/me")).userPrincipalName.toLowerCase());

  const res = await graph(
    "GET",
    "/me/mailFolders/inbox/messages?$filter=isRead eq false&$top=20&$select=id,subject,from,bodyPreview,receivedDateTime",
  );

  for (const msg of res.value) {
    if (state.processed.includes(msg.id)) continue;
    state.processed.push(msg.id);

    const from = norm(msg.from?.emailAddress?.address);
    // ALLOW_SELF=1 — тестовый режим: обрабатывать письма от самого себя
    if (!from || (from === me && !process.env.ALLOW_SELF)) continue;
    if (cfg.settings.skip_senders.some((w) => from.includes(norm(w)))) {
      console.log("пропуск (рассылка/уведомление):", from, "|", msg.subject);
      continue;
    }

    const last = state.lastReplyTo[from] || 0;
    const cooldownMs = cfg.settings.reply_cooldown_hours * 3600 * 1000;
    if (Date.now() - last < cooldownMs) {
      console.log("пропуск (уже отвечали недавно):", from);
      continue;
    }

    // Заявки на оплату распознаём по полному тексту письма, а не по bodyPreview:
    // ИНН и список слушателей часто не влезают в первые 255 символов.
    const full = await graph(
      "GET",
      `/me/messages/${msg.id}?$select=body,subject,from`,
    );
    const text =
      full.body.contentType === "html"
        ? htmlToText(full.body.content)
        : full.body.content;

    if (looksLikePaymentRequest(text)) {
      const parsed = parsePaymentRequest(text);
      const row = {
        from_email: from,
        subject: msg.subject || null,
        received_at: msg.receivedDateTime,
        ...parsed,
        raw_body: text,
      };
      let saved = false;
      try {
        await insertPaymentRequest(row);
        saved = true;
      } catch (e) {
        console.error("ошибка записи в Supabase:", e.message);
        await notify(
          `⚠️ Заявка от ${from} НЕ записана в базу: ${e.message.slice(0, 300)}`,
        );
      }
      await graph("POST", `/me/messages/${msg.id}/reply`, {
        comment: cfg.payment_request_reply,
      });
      state.lastReplyTo[from] = Date.now();
      console.log(
        "заявка на оплату:",
        from,
        "| курс:",
        parsed.course,
        "| в базе:",
        saved,
      );
      await notify(
        `📧 Заявка на оплату от ${from}\n` +
          `Курс: ${parsed.course || "—"}\n` +
          `Дата: ${parsed.event_date || "—"}\nОрг: ${parsed.org_name || "—"}\n` +
          `ИНН: ${parsed.inn || "—"}  КПП: ${parsed.kpp || "—"}\n` +
          `Адрес: ${parsed.postal_address || "—"}\n` +
          `Слушатели: ${parsed.students.join("; ") || "—"}\n` +
          `В базе: ${saved ? "да" : "НЕТ"} | Автоответ отправлен`,
      );
      continue;
    }

    const rule = cfg.rules.find((r) => matches(r, msg));
    const reply = rule ? rule.reply : cfg.default_reply;
    if (!reply) {
      console.log("нет подходящего правила:", from, "|", msg.subject);
      continue;
    }

    await graph("POST", `/me/messages/${msg.id}/reply`, { comment: reply });
    state.lastReplyTo[from] = Date.now();
    console.log(
      `ответил (${rule ? rule.name : "общий шаблон"}):`,
      from,
      "|",
      msg.subject,
    );
    await notify(
      `📧 Автоответ для ${from}\nТема: ${msg.subject || "(без темы)"}\nПравило: ${rule ? rule.name : "общий шаблон"}`,
    );
  }

  // не даём списку обработанных писем расти бесконечно
  state.processed = state.processed.slice(-500);
  writeJson(STATE_FILE, state);
}

async function main() {
  const once = process.argv[2] === "once";
  const cfg = readJson(RULES_FILE);
  console.log(`бот запущен, проверка каждые ${cfg.settings.poll_seconds} c`);
  while (true) {
    try {
      await checkOnce();
    } catch (e) {
      console.error(new Date().toISOString(), "ошибка:", e.message);
      if (e.message.includes("token"))
        await notify(
          "⚠️ Почтовый бот: проблема с токеном, нужен повторный вход.",
        );
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, cfg.settings.poll_seconds * 1000));
  }
}

main();
