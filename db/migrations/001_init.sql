-- PoultryGrid AI schema for Neon Postgres.
-- Ported from the Supabase migrations. Supabase auth and RLS are replaced by
-- app-managed users/sessions; access control lives in the server functions
-- (src/lib/api/*.functions.ts).

create extension if not exists pgcrypto;

do $$ begin
  create type app_role as enum ('admin', 'manager', 'worker');
exception when duplicate_object then null; end $$;

-- Auth -------------------------------------------------------------------

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);
create unique index if not exists users_email_key on users (lower(email));

create table if not exists user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role app_role not null,
  unique (user_id, role)
);

create table if not exists sessions (
  token_hash text primary key,          -- sha256 of the cookie token; the token itself is never stored
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expires_idx on sessions (expires_at);

-- Farm -------------------------------------------------------------------

create table if not exists farms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  region text,
  owner_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists poultry_houses (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  name text not null,
  capacity int default 0,
  bird_count int default 0,
  batch_name text,
  batch_started_at date,                -- flock age for the edge AI is derived from this
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  api_key text not null,
  type text not null default 'sensor', -- sensor | camera | controller | pi
  farm_id uuid references farms(id) on delete set null,
  house_id uuid references poultry_houses(id) on delete set null,
  location text,
  firmware_version text,
  fan_override text check (fan_override in ('low', 'medium', 'high')),
  last_seen timestamptz,
  online boolean default false,
  created_at timestamptz not null default now()
);

create table if not exists sensor_readings (
  id bigserial primary key,
  device_id uuid not null references devices(id) on delete cascade,
  house_id uuid references poultry_houses(id) on delete set null,
  temperature numeric,
  humidity numeric,
  air_quality numeric,
  gas_index numeric,                    -- MQ-135 relative index (0 = clean-air baseline)
  water_level numeric,
  feed_level numeric,
  light numeric,
  current_a numeric,
  fan_rpm numeric,
  fan_duty numeric,
  bird_age_days numeric,
  -- Edge AI output (Raspberry Pi agent)
  ai_status text check (ai_status in ('healthy', 'warning', 'critical')),
  ai_confidence numeric,
  ai_probabilities jsonb,
  ai_causes jsonb,
  fan_level text,
  growth_phase text,
  target_temp numeric,
  model_version text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sensor_readings_device_idx on sensor_readings (device_id, created_at desc);
create index if not exists sensor_readings_house_idx on sensor_readings (house_id, created_at desc);
create index if not exists sensor_readings_created_idx on sensor_readings (created_at desc);

create table if not exists hatcheries (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  name text not null,
  egg_count int default 0,
  started_at timestamptz,
  expected_hatch_at timestamptz,
  temperature numeric,
  humidity numeric,
  hatched_count int default 0,
  created_at timestamptz not null default now()
);

create table if not exists cameras (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid references farms(id) on delete set null,
  house_id uuid references poultry_houses(id) on delete set null,
  name text not null,
  stream_url text,
  status text default 'offline',
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid references farms(id) on delete cascade,
  house_id uuid references poultry_houses(id) on delete set null,
  device_id uuid references devices(id) on delete set null,
  severity text not null default 'info', -- info | warning | critical
  type text not null,                    -- temperature | humidity | disease | power | offline | camera | ai
  message text not null,
  resolved boolean default false,
  created_at timestamptz not null default now()
);
create index if not exists alerts_created_idx on alerts (created_at desc);

create table if not exists energy_records (
  id bigserial primary key,
  farm_id uuid not null references farms(id) on delete cascade,
  solar_w numeric default 0,
  battery_pct numeric default 0,
  consumption_w numeric default 0,
  created_at timestamptz not null default now()
);
create index if not exists energy_records_farm_idx on energy_records (farm_id, created_at desc);

create table if not exists biogas_records (
  id bigserial primary key,
  farm_id uuid not null references farms(id) on delete cascade,
  gas_m3 numeric default 0,
  waste_kg numeric default 0,
  fertilizer_kg numeric default 0,
  efficiency_pct numeric default 0,
  created_at timestamptz not null default now()
);
create index if not exists biogas_records_farm_idx on biogas_records (farm_id, created_at desc);
