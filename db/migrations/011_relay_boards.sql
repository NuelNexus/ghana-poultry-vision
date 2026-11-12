-- The incubator relay board (firmware/relay_board): an ESP32 with four relays
-- (incubator controller, fan, light, strip light) switched from Automation.
-- "desired" is what the site wants, bumped to a new version on each change;
-- "reported" is what the board last said its relays are. While someone has the
-- Automation page open (watched_until), the board checks in every 1.5 s.
create table if not exists relay_boards (
  device_id uuid primary key references devices(id) on delete cascade,
  desired jsonb not null default '{"incubator": true, "fan": true, "light": true, "strip": true}',
  version integer not null default 1,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  reported jsonb,
  reported_version integer,
  reported_at timestamptz,
  watched_until timestamptz
);
