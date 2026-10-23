-- Ama chat history: one row per conversation, one per message (text chat and voice turns).
-- Each user only sees their own conversations (enforced in src/lib/api/assistant.functions.ts).

create table if not exists ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_conversations_user_idx on ai_conversations (user_id, updated_at desc);

create table if not exists ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  mode text not null default 'text' check (mode in ('text', 'voice')),
  language text,
  -- English translation of a voice turn in another language (shown under it)
  english text,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_conversation_idx on ai_messages (conversation_id, created_at);
