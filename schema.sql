-- Таблица заявок «прошу направить реквизиты для оплаты».
-- Вставить в Supabase: SQL Editor → New query → выполнить.
create table if not exists payment_requests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source_message_id text unique,       -- id письма Graph, защита от дублей
  received_at timestamptz,          -- когда пришло письмо
  from_email text,
  subject text,
  course text,                      -- название курса/вебинара
  event_date text,                  -- дата проведения (только для вебинаров)
  org_name text,                    -- плательщик: название организации
  inn text,
  kpp text,
  postal_address text,
  students jsonb default '[]',      -- список ФИО слушателей
  raw_body text,                    -- полный текст письма на случай ошибок парсера
  status text not null default 'new'  -- new / invoiced / paid — на будущее
);

-- Бот пишет через service_role key, поэтому доступ с обычным anon-ключом закрыт.
alter table payment_requests enable row level security;

-- Миграция для существующей таблицы (выполнить перед обновлением бота).
alter table payment_requests add column if not exists source_message_id text;
create unique index if not exists payment_requests_source_message_id_uidx
  on payment_requests (source_message_id)
  where source_message_id is not null;
