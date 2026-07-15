/**
 * @fileoverview Собирает зависимости и запускает почтовый worker.
 */
// Composition root: собирает граф зависимостей, определяет
// адрес ящика, запускает поллер и корректно завершается по SIGTERM/SIGINT.
'use strict';
const config = require('./config');
const { createLogger } = require('./logger');
const { Authenticator } = require('./auth');
const { GraphClient, MailService } = require('./graph');
const { StateStore } = require('./state');
const { PaymentRepo } = require('./supabase');
const { MessageProcessor } = require('./processor');
const { Poller } = require('./poller');
const { Catalog } = require('./catalog');
const { ReplyRenderer } = require('./render');
const fs = require('fs');

/**
 * Собирает приложение, проверяет доступ к ящику и запускает poller.
 * @return {!Promise<void>}
 */
async function main() {
  const cfg = config.load(); // fail-fast: бросит понятную ошибку при плохом конфиге
  const logger = createLogger();
  const clock = { now: () => Date.now() };

  const auth = new Authenticator({
    tokenPath: cfg.paths.token, clientId: cfg.graph.clientId,
    tenant: cfg.graph.tenant, scope: cfg.graph.scope, logger,
  });
  const client = new GraphClient({ auth, baseUrl: cfg.graph.baseUrl, logger });
  const mail = new MailService({ client });
  const repo = new PaymentRepo({
    url: cfg.supabase.url, key: cfg.supabase.key, table: cfg.supabase.table,
    deadletterPath: cfg.paths.deadletter, logger,
  });
  // dry-run меняет состояние только в памяти и не может «съесть» рабочие письма.
  const state = new StateStore({
    path: cfg.paths.state, cap: cfg.processedCap, persist: !cfg.dryRun,
  });

  const selfAddress = await mail.whoAmI();
  logger.info('вход в ящик подтверждён', { mailbox: selfAddress });

  // каталог цен + шаблон ответа + вложение-платёжка (грузим один раз)
  const catalog = new Catalog({ pricesPath: cfg.paths.prices });
  const renderer = new ReplyRenderer({ templatePath: cfg.paths.template });
  const attachment = {
    name: cfg.attachmentName,
    contentType: 'application/vnd.ms-excel',
    contentBytes: fs.readFileSync(cfg.paths.attachment).toString('base64'),
  };
  logger.info('каталог и вложение загружены', { courses: catalog.size });

  const processor = new MessageProcessor({
    mail, repo, state, config: cfg, logger, clock, selfAddress,
    catalog, renderer, attachment, humanCheckFolder: cfg.humanCheckFolder,
  });
  const poller = new Poller({ mail, state, processor, config: cfg, logger, clock });

  // корректное завершение: дать текущему циклу закончиться и сохранить состояние
  const shutdown = (sig) => { logger.info('получен сигнал, останавливаюсь', { sig }); poller.stop(); };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => logger.error('unhandledRejection', { error: String(e) }));

  await poller.start();
  process.exit(0);
}

main().catch((err) => {
  // на этом этапе логгер уже мог не подняться — печатаем как есть
  console.error(err.code === 'CONFIG' ? err.message : err.stack || String(err));
  process.exit(1);
});
