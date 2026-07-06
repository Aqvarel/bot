// Точка входа (composition root): собирает граф зависимостей, определяет
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
  const state = new StateStore({ path: cfg.paths.state, cap: cfg.processedCap });

  const selfAddress = await mail.whoAmI();
  logger.info('вход в ящик подтверждён', { mailbox: selfAddress });

  const processor = new MessageProcessor({ mail, repo, state, config: cfg, logger, clock, selfAddress });
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
