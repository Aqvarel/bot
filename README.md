# Почтовый бот-автоответчик (Outlook → Supabase)

Бот следит за ящиком Outlook, распознаёт заявки в тексте письма и во вложениях
`.pdf`/`.docx` «прошу направить реквизиты для оплаты курса», разбирает их
(курс, дата, организация, ИНН, КПП,
адрес, ФИО слушателей), сохраняет в Supabase и отвечает отправителю шаблоном.

Написан как продакшн-сервис: слоистая архитектура, структурное логирование,
ретраи с backoff, идемпотентная обработка и graceful shutdown. Требуется Node.js ≥ 20.

## Архитектура

```
src/
  index.js       — composition root: сборка зависимостей, запуск, SIGTERM
  config.js      — загрузка и валидация конфигурации (fail-fast)
  logger.js      — структурный логгер (уровни, контекст, pretty/json)
  util.js        — sleep, атомарная запись, retry с экспоненциальным backoff
  auth.js        — токены Microsoft: refresh (single-flight) + device code flow
  graph.js       — шлюз Graph: HTTP-клиент (ретраи, 429 Retry-After) + почта
  attachment-text.js — извлечение текста из PDF/DOCX-вложений
  state.js       — состояние: high-water-mark + идемпотентность + кулдаун
  supabase.js    — репозиторий заявок с ретраями и dead-letter
  classify.js    — сопоставление письма с правилами
  processor.js   — обработка одного письма (use-case, внедрение зависимостей)
  poller.js      — цикл опроса с health-файлом и мягкой остановкой
parser.js        — чистый разбор текста заявки (переиспользуется в тестах)
test/            — юнит-тесты (node --test)
```

**Как ловятся письма.** Вместо хрупкого «только непрочитанные» бот держит
отметку времени последнего обработанного письма (high-water-mark) и забирает
все письма новее неё — независимо от того, прочитал их кто-то раньше или нет.
Повторная обработка исключена множеством обработанных id (идемпотентность).

Авторизация — через публичный client ID «Microsoft Graph Command Line Tools»,
поэтому своё приложение в Azure регистрировать не нужно (личным аккаунтам
Microsoft портал Azure недоступен).

## Запуск

```bash
# 1. вход в почту (один раз): показывает код и ссылку, ждёт подтверждения
npm run login          # = node src/login.js

# 2. создать таблицу из schema.sql в Supabase SQL Editor, затем положить рядом
#    supabase.json: { "url": "https://<проект>.supabase.co", "service_role_key": "..." }

# 3. проверка без отправки (dry-run) / постоянная работа
npm run dry-run        # логирует, что сделал бы, ничего не отправляя
npm start              # = node src/index.js

# тесты
npm test               # = node --test
```

Как служба — `systemd` юнит `mail-autoreply-bot` (Restart=always, корректная
остановка по SIGTERM). Состояние службы: `systemctl status mail-autoreply-bot`,
логи: `journalctl -u mail-autoreply-bot -f`.

## Надёжность и защита

- **Ретраи** с экспоненциальным backoff на сетевые сбои и троттлинг Graph (429);
- **Dead-letter**: если Supabase недоступен после повторов — заявка не теряется,
  а падает в `deadletter.jsonl` для ручной доотправки;
- **Идемпотентность**: одно письмо не обрабатывается дважды;
- **Идемпотентность в БД**: `source_message_id` уникален, повторный insert безопасен;
- **Антиспам**: одному отправителю не чаще раза в сутки (`reply_cooldown_hours`);
- кулдаун относится только к общим автоответам и не отбрасывает новые заявки;
- рассылки и no-reply адреса пропускаются (`skip_senders`);
- письма без признаков заявки остаются без ответа;
- PDF/DOCX ограничены 10 МБ, проверяются по сигнатуре и имеют таймаут разбора;
- `dry-run` использует состояние только в памяти и не изменяет рабочий `state.json`;
- **health-файл** `health.json` — время и итог последнего цикла для мониторинга.

PDF должен содержать текстовый слой. Сканированные документы без OCR не
распознаются и требуют отдельного OCR-сервиса.

## Обновление существующей установки

Перед первым запуском этой версии выполните последние команды из `schema.sql`:

```sql
alter table payment_requests add column if not exists source_message_id text;
create unique index if not exists payment_requests_source_message_id_uidx
  on payment_requests (source_message_id)
  where source_message_id is not null;
```

После обновления кода установите зависимости и прогоните тесты:

```bash
npm ci
npm test
```

## Конфигурация

`rules.json` — поведение: `payment_request_reply` (шаблон ответа), `settings`
(`poll_seconds`, `reply_cooldown_hours`, `skip_senders`), `rules`, `default_reply`.
Переопределяется переменными окружения: `POLL_SECONDS`, `REPLY_COOLDOWN_HOURS`,
`LOG_LEVEL`, `LOG_FORMAT` (pretty|json), `DRY_RUN=1`.

Секреты (`token.json`, `supabase.json`) и рабочие файлы (`state.json`,
`health.json`, `deadletter.jsonl`) в репозиторий не попадают — см. `.gitignore`.
