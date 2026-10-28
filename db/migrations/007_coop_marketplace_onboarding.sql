-- Unit 2 (the ESP32 coop controller) with remote control from the site, the
-- marketplace, and the first-login tour.

-- Devices: which unit of the PoultryGrid kit each device is ----------------
--   brooder = unit 1, incubator & brooder (Raspberry Pi edge AI, edge/)
--   coop    = unit 2, the coop controller (ESP32: layers + broilers zones,
--             fan and lamp relays, water turbidity; firmware/coop_unit/)
alter table devices add column if not exists unit text check (unit in ('brooder', 'coop'));
alter table devices add column if not exists last_rssi int;
update devices set unit = 'brooder' where unit is null and type = 'pi';

-- Coop readings ---------------------------------------------------------------
alter table sensor_readings add column if not exists zones jsonb;          -- per zone: temp, humidity, fan, lamp, mode
alter table sensor_readings add column if not exists water_turbidity_v numeric;
alter table sensor_readings add column if not exists water_ok boolean;
alter table sensor_readings add column if not exists config_version int;   -- controls version the coop was running

-- Remote controls ----------------------------------------------------------
-- The coop's desired settings. The coop fetches them with every check-in
-- (about every 10 s) and reports back the version it applied.
create table if not exists device_controls (
  device_id uuid primary key references devices(id) on delete cascade,
  config jsonb not null,
  version int not null default 1,
  applied_version int,
  applied_at timestamptz,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists control_log (
  id bigserial primary key,
  device_id uuid not null references devices(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  change jsonb not null,
  version int not null,
  created_at timestamptz not null default now()
);
create index if not exists control_log_device_idx on control_log (device_id, created_at desc);

-- Marketplace ----------------------------------------------------------------
-- Shared by every account: farms sell to each other. Each listing, photo and
-- message belongs to a real account; nothing is seeded.

create table if not exists listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  category text not null check (category in
    ('eggs', 'broilers', 'layers', 'cockerels', 'chicks', 'guinea_fowl', 'turkey', 'manure', 'feed', 'equipment', 'other')),
  description text check (char_length(description) <= 2000),
  price numeric(12, 2) not null check (price >= 0),
  unit text not null check (unit in ('crate', 'bird', 'kg', 'bag', 'piece', 'dozen', 'tray', 'lot')),
  quantity numeric(12, 2) check (quantity >= 0),
  region text,
  location text,
  contact_phone text,
  whatsapp boolean not null default false,
  status text not null default 'active' check (status in ('active', 'paused', 'sold')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists listings_browse_idx on listings (status, created_at desc);
create index if not exists listings_seller_idx on listings (seller_id, created_at desc);
create index if not exists listings_category_idx on listings (category) where status = 'active';

create table if not exists listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  position int not null default 0,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  data bytea not null check (octet_length(data) <= 800000),
  created_at timestamptz not null default now()
);
create index if not exists listing_images_listing_idx on listing_images (listing_id, position);

create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  buyer_id uuid not null references users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 1000),
  quantity numeric(12, 2),
  buyer_phone text,
  status text not null default 'new' check (status in ('new', 'seen', 'closed')),
  created_at timestamptz not null default now()
);
create index if not exists inquiries_listing_idx on inquiries (listing_id, created_at desc);
create index if not exists inquiries_buyer_idx on inquiries (buyer_id, created_at desc);

-- First-login tour ---------------------------------------------------------------
-- Shown once to new accounts. Accounts that already exist know the site.
alter table users add column if not exists onboarded_at timestamptz;
update users set onboarded_at = now() where onboarded_at is null;
