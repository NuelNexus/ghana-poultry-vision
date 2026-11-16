-- 1. Presets: the birds a farmer keeps, picked at sign-up (src/lib/presets.ts).
alter table users add column if not exists poultry_preset text;

-- 2. The incubator relay board's DHT22 (GPIO 14): its latest reading, and the
--    temperature/humidity band it is checked against (an incubator preset or custom).
alter table relay_boards add column if not exists reading jsonb;
alter table relay_boards add column if not exists reading_at timestamptz;
alter table relay_boards add column if not exists targets jsonb;

-- A short history so the Automation page can show the last hours.
create table if not exists relay_readings (
  id bigserial primary key,
  device_id uuid not null references devices(id) on delete cascade,
  temp real,
  humidity real,
  created_at timestamptz not null default now()
);
create index if not exists relay_readings_device_time on relay_readings (device_id, created_at desc);

-- 3. Camera vision (edge/vision.py, YOLO11n on the Pi or a PC): each camera's
--    latest analysis and annotated frame, plus events (pests, inactive birds).
create table if not exists camera_vision (
  camera_id uuid primary key references cameras(id) on delete cascade,
  analysed_at timestamptz not null default now(),
  birds integer not null default 0,
  inactive integer not null default 0,
  activity real,              -- 0..1, share of tracked birds that moved recently
  pests jsonb not null default '[]',   -- [{label, confidence}]
  frame bytea,                -- annotated JPEG, small
  worker text                 -- which machine ran it ("pi-house-a", "office-pc")
);

create table if not exists vision_events (
  id bigserial primary key,
  camera_id uuid not null references cameras(id) on delete cascade,
  kind text not null check (kind in ('pest', 'inactive', 'low_activity')),
  label text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists vision_events_camera_time on vision_events (camera_id, created_at desc);
