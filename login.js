// Вход в Microsoft-аккаунт через device code flow.
//
//   node login.js request  — получить код для входа (показывает код и ссылку)
//   node login.js poll     — ждать, пока код введут на microsoft.com/link,
//                            затем сохранить токены в token.json
const {
  CLIENT_ID,
  TENANT,
  SCOPE,
  DEVICE_FILE,
  notify,
  readJson,
  writeJson,
  saveToken,
  graph,
} = require("./lib");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request() {
  const res = await fetch(`${TENANT}/oauth2/v2.0/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  writeJson(DEVICE_FILE, { ...data, requested_at: Date.now() });
  console.log(
    JSON.stringify({
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in,
    }),
  );
}

async function poll() {
  const dev = readJson(DEVICE_FILE);
  if (!dev)
    throw new Error("device.json не найден — сначала node login.js request");
  const deadline = dev.requested_at + dev.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep((dev.interval || 5) * 1000);
    const res = await fetch(`${TENANT}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: dev.device_code,
      }),
    });
    const data = await res.json();

    if (res.ok) {
      saveToken(data);
      const me = await graph("GET", "/me");
      const who = me.userPrincipalName || me.mail || me.displayName;
      console.log("OK: вход выполнен как", who);
      await notify(
        `✅ Почтовый бот: вход в ${who} выполнен, токены сохранены.`,
      );
      return;
    }
    if (data.error === "authorization_pending") continue;
    if (data.error === "expired_token") break;
    throw new Error("ошибка входа: " + JSON.stringify(data));
  }
  console.log(
    "EXPIRED: код истёк, нужно запросить новый (node login.js request)",
  );
  process.exit(2);
}

const cmd = process.argv[2];
if (cmd === "request") request();
else if (cmd === "poll") poll();
else console.log("использование: node login.js request | poll");
