create table employees (
  phone       text primary key,
  name        text not null,
  department  text not null,
  email       text,
  source      text not null check (source in ('csv', 'auto')),
  created_at  timestamptz not null default now()
);

create table conversations (
  phone               text primary key,
  state               text not null default 'idle'
    check (state in ('idle', 'collecting', 'awaitingConfirmation', 'humanHandling', 'closed')),
  partial_data        jsonb not null default '{}',
  last_interaction_at timestamptz not null default now(),
  paused_until        timestamptz
);

create table messages (
  id                  bigint generated always as identity primary key,
  whatsapp_message_id text unique,
  phone               text not null,
  direction           text not null check (direction in ('inbound', 'outbound')),
  source              text not null check (source in ('user', 'bot', 'human')),
  type                text not null check (type in ('text', 'audio', 'image')),
  content             text,
  created_at          timestamptz not null default now()
);

create index messages_phone_created_idx on messages (phone, created_at desc);

create table tickets (
  jira_key             text primary key,
  phone                text not null,
  last_notified_status text,
  created_at           timestamptz not null default now()
);

create index tickets_phone_idx on tickets (phone);

create table context_cache (
  url        text primary key,
  content    text not null,
  updated_at timestamptz not null default now()
);
