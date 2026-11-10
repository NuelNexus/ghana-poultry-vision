-- NELVIN, our fine-tuned male Twi voice, becomes a voice choice and the default.
-- Accounts on the old default (male, stock twi-6) move to NELVIN; female stays female.
alter table users drop constraint if exists users_voice_check;
alter table users add constraint users_voice_check check (voice in ('nelvin', 'male', 'female'));
alter table users alter column voice set default 'nelvin';
update users set voice = 'nelvin' where voice = 'male';
alter table tts_jobs alter column voice set default 'nelvin';
