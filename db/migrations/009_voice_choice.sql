-- Each account picks Ama's voice: male (stable-twi-tts twi-6, the default) or female (twi-1).
-- The other engines follow the same choice (Khaya male_low / female, OpenAI ash / nova).
alter table users add column if not exists voice text not null default 'male'
  check (voice in ('male', 'female'));
