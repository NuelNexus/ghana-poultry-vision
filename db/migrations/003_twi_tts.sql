-- Twi voice on the Raspberry Pi (edge/twi_tts.py, the stable-twi-tts model).
-- The Pi sits behind the farm router, so the site can't call it. Instead the
-- site queues each reply here and the Pi, polling /api/public/devices/tts with
-- its device key, claims the job, speaks it and uploads the WAV.

alter table devices add column if not exists tts_seen_at timestamptz;      -- last poll by its voice service
alter table devices add column if not exists tts_wanted_until timestamptz; -- poll fast until then (someone is talking to Ama)

create table if not exists tts_jobs (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  voice text not null default 'twi-6',
  status text not null default 'queued' check (status in ('queued', 'working', 'done', 'error')),
  device_id uuid references devices(id) on delete set null,
  audio text,   -- base64 WAV, cleared after the site reads it
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tts_jobs_queue_idx on tts_jobs (status, created_at);
