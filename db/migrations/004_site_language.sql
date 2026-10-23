-- Site language: each account picks the language the site is shown in, and every
-- English string on the site is translated once per language and kept here.

alter table users add column if not exists language text not null default 'en';

create table if not exists ui_translations (
  lang text not null,
  source text not null,          -- English, numbers replaced by ⟦0⟧, ⟦1⟧ ...
  text text not null,
  engine text not null,          -- khaya or the OpenAI model that wrote it
  created_at timestamptz not null default now(),
  primary key (lang, source)
);
-- Lets the read-aloud check "is this site text?" without scanning.
create index if not exists ui_translations_text on ui_translations using hash (text);

-- Ama's Twi voice is now the female twi-1.
alter table tts_jobs alter column voice set default 'twi-1';
