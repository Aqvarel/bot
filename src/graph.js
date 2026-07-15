// Шлюз Microsoft Graph: HTTP-клиент с авторизацией, ретраями и уважением к
// троттлингу (429 Retry-After), плюс доменные операции с почтой.
"use strict";
const { withRetry } = require("./util");

class GraphError extends Error {
  constructor(message, status, retryAfterMs) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// повторяем сетевые сбои, 429 и 5xx; не повторяем 4xx (кроме 429)
const isTransient = (err) =>
  !err.status || err.status === 429 || (err.status >= 500 && err.status < 600);

class GraphClient {
  #auth;
  #baseUrl;
  #logger;
  constructor({ auth, baseUrl, logger }) {
    this.#auth = auth;
    this.#baseUrl = baseUrl;
    this.#logger = logger;
  }

  async request(method, urlOrPath, body) {
    const url = urlOrPath.startsWith("http")
      ? urlOrPath
      : this.#baseUrl + urlOrPath;
    return withRetry(
      async () => {
        const token = await this.#auth.getAccessToken();
        const res = await fetch(url, {
          method,
          signal: AbortSignal.timeout(30_000),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (res.status === 202 || res.status === 204) return null;
        if (!res.ok) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const text = await res.text().catch(() => "");
          throw new GraphError(
            `${method} ${url} → ${res.status} ${text.slice(0, 300)}`,
            res.status,
            retryAfter ? retryAfter * 1000 : undefined,
          );
        }
        return res.json();
      },
      {
        // GET/PATCH идемпотентны для используемых операций. POST (ответ,
        // отправка, move, createReply) автоматически не повторяем: сервер мог
        // выполнить действие до обрыва соединения.
        retries: method === "POST" ? 0 : 4,
        retryable: isTransient,
        onRetry: (err, attempt, delay) =>
          this.#logger?.warn("повтор запроса Graph", {
            attempt,
            delayMs: delay,
            status: err.status,
          }),
      },
    );
  }

  get(p) {
    return this.request("GET", p);
  }
  post(p, b) {
    return this.request("POST", p, b);
  }
  patch(p, b) {
    return this.request("PATCH", p, b);
  }
}

class MailService {
  #client;
  constructor({ client }) {
    this.#client = client;
  }

  async whoAmI() {
    const me = await this.#client.get("/me");
    return (me.userPrincipalName || me.mail || "").toLowerCase();
  }

  // Все письма, пришедшие начиная с isoTime (включительно), по возрастанию —
  // независимо от статуса прочтения. Это чинит баг «письмо открыли раньше бота».
  async fetchSince(isoTime, pageSize = 50) {
    const params = new URLSearchParams({
      $filter: `receivedDateTime ge ${isoTime}`,
      $orderby: "receivedDateTime asc",
      $top: String(pageSize),
      $select: "id,subject,from,bodyPreview,receivedDateTime,isRead",
    });
    let path = `/me/mailFolders/inbox/messages?${params}`;
    const out = [];
    while (path) {
      const data = await this.#client.get(path);
      out.push(...(data.value || []));
      path = data["@odata.nextLink"] || null; // nextLink абсолютный — клиент это учитывает
    }
    return out;
  }

  getBody(id) {
    return this.#client.get(`/me/messages/${id}?$select=body,subject,from`);
  }
  async listAttachments(id) {
    const data = await this.#client.get(
      `/me/messages/${id}/attachments?$select=id,name,contentType,size,isInline`,
    );
    return data.value || [];
  }
  getAttachment(messageId, attachmentId) {
    return this.#client.get(
      `/me/messages/${messageId}/attachments/${encodeURIComponent(attachmentId)}`,
    );
  }
  reply(id, comment) {
    return this.#client.post(`/me/messages/${id}/reply`, { comment });
  }
  markRead(id) {
    return this.#client.patch(`/me/messages/${id}`, { isRead: true });
  }

  // Ответить с телом-текстом И вложением: создаём черновик-ответ (сохраняет
  // тему/цепочку), задаём тело, прикрепляем файл, отправляем.
  async replyWithAttachment(id, bodyText, attachment) {
    const draft = await this.#client.post(`/me/messages/${id}/createReply`, {});
    await this.#client.patch(`/me/messages/${draft.id}`, {
      body: { contentType: "text", content: bodyText },
    });
    await this.#client.post(`/me/messages/${draft.id}/attachments`, {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: attachment.name,
      contentType: attachment.contentType || "application/octet-stream",
      contentBytes: attachment.contentBytes, // base64
    });
    await this.#client.post(`/me/messages/${draft.id}/send`, null);
  }

  // id папки по имени в корне почты; создаём, если нет (кэшируется вызывающим).
  async ensureFolder(displayName) {
    const list = await this.#client.get(
      `/me/mailFolders?$top=100&$select=id,displayName`,
    );
    const found = (list.value || []).find((f) => f.displayName === displayName);
    if (found) return found.id;
    const created = await this.#client.post("/me/mailFolders", { displayName });
    return created.id;
  }

  moveToFolder(id, folderId) {
    return this.#client.post(`/me/messages/${id}/move`, {
      destinationId: folderId,
    });
  }
}

module.exports = { GraphClient, MailService, GraphError };
