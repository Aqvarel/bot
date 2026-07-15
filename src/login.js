/**
 * @fileoverview Выполняет первичный device-code вход в Microsoft.
 */
//   node src/login.js
// Показывает код и ссылку, ждёт подтверждения и сохраняет токены.
'use strict';
const config = require('./config');
const { createLogger } = require('./logger');
const { Authenticator } = require('./auth');
const { GraphClient, MailService } = require('./graph');

/**
 * Запрашивает device code, ожидает пользователя и проверяет текущий ящик.
 * @return {!Promise<void>}
 */
async function main() {
  const cfg = config.load();
  const logger = createLogger({ format: 'pretty' });
  const auth = new Authenticator({
    tokenPath: cfg.paths.token, clientId: cfg.graph.clientId,
    tenant: cfg.graph.tenant, scope: cfg.graph.scope, logger,
  });

  const device = await auth.requestDeviceCode();
  console.log('\n  Откройте: ' + device.verification_uri);
  console.log('  Код:      ' + device.user_code + '\n');
  logger.info('ожидаю подтверждения входа…');

  await auth.pollForToken(device);
  const mail = new MailService({ client: new GraphClient({ auth, baseUrl: cfg.graph.baseUrl, logger }) });
  const who = await mail.whoAmI();
  logger.info('вход выполнен, токены сохранены', { mailbox: who });
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
