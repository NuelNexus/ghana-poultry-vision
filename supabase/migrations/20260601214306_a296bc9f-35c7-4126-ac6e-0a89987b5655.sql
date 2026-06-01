
-- Roles enum
create type public.app_role as enum ('admin', 'manager', 'worker');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "own profile write" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert to authenticated with check (auth.uid() = id);

-- User roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "users see own roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "admins manage roles" on public.user_roles for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- Farms
create table public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  region text,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.farms to authenticated;
grant all on public.farms to service_role;
alter table public.farms enable row level security;
create policy "auth read farms" on public.farms for select to authenticated using (true);
create policy "admin/manager write farms" on public.farms for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager'));

-- Poultry houses
create table public.poultry_houses (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null,
  capacity int default 0,
  bird_count int default 0,
  batch_name text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.poultry_houses to authenticated;
grant all on public.poultry_houses to service_role;
alter table public.poultry_houses enable row level security;
create policy "auth read houses" on public.poultry_houses for select to authenticated using (true);
create policy "admin/manager write houses" on public.poultry_houses for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager'));

-- Devices (ESP32)
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  api_key text not null,
  type text not null default 'sensor', -- sensor | camera | controller
  farm_id uuid references public.farms(id) on delete set null,
  house_id uuid references public.poultry_houses(id) on delete set null,
  location text,
  firmware_version text,
  last_seen timestamptz,
  online boolean default false,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.devices to authenticated;
grant all on public.devices to service_role;
alter table public.devices enable row level security;
create policy "auth read devices" on public.devices for select to authenticated using (true);
create policy "admin/manager write devices" on public.devices for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager'));

-- Sensor readings
create table public.sensor_readings (
  id bigserial primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  house_id uuid references public.poultry_houses(id) on delete set null,
  temperature numeric,
  humidity numeric,
  air_quality numeric,
  water_level numeric,
  feed_level numeric,
  light numeric,
  current_a numeric,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index on public.sensor_readings (device_id, created_at desc);
create index on public.sensor_readings (house_id, created_at desc);
grant select, insert on public.sensor_readings to authenticated;
grant all on public.sensor_readings to service_role;
alter table public.sensor_readings enable row level security;
create policy "auth read readings" on public.sensor_readings for select to authenticated using (true);

-- Hatcheries
create table public.hatcheries (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null,
  egg_count int default 0,
  started_at timestamptz,
  expected_hatch_at timestamptz,
  temperature numeric,
  humidity numeric,
  hatched_count int default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.hatcheries to authenticated;
grant all on public.hatcheries to service_role;
alter table public.hatcheries enable row level security;
create policy "auth read hatcheries" on public.hatcheries for select to authenticated using (true);
create policy "admin/manager write hatcheries" on public.hatcheries for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager'));

-- Cameras
create table public.cameras (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid references public.farms(id) on delete set null,
  house_id uuid references public.poultry_houses(id) on delete set null,
  name text not null,
  stream_url text,
  status text default 'offline',
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.cameras to authenticated;
grant all on public.cameras to service_role;
alter table public.cameras enable row level security;
create policy "auth read cameras" on public.cameras for select to authenticated using (true);
create policy "admin/manager write cameras" on public.cameras for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager'));

-- Alerts
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid references public.farms(id) on delete cascade,
  house_id uuid references public.poultry_houses(id) on delete set null,
  device_id uuid references public.devices(id) on delete set null,
  severity text not null default 'info', -- info | warning | critical
  type text not null, -- temperature | humidity | disease | power | offline | camera
  message text not null,
  resolved boolean default false,
  created_at timestamptz not null default now()
);
create index on public.alerts (created_at desc);
grant select, insert, update, delete on public.alerts to authenticated;
grant all on public.alerts to service_role;
alter table public.alerts enable row level security;
create policy "auth read alerts" on public.alerts for select to authenticated using (true);
create policy "auth write alerts" on public.alerts for insert to authenticated with check (true);
create policy "auth update alerts" on public.alerts for update to authenticated using (true);

-- Energy records
create table public.energy_records (
  id bigserial primary key,
  farm_id uuid not null references public.farms(id) on delete cascade,
  solar_w numeric default 0,
  battery_pct numeric default 0,
  consumption_w numeric default 0,
  created_at timestamptz not null default now()
);
create index on public.energy_records (farm_id, created_at desc);
grant select, insert on public.energy_records to authenticated;
grant all on public.energy_records to service_role;
alter table public.energy_records enable row level security;
create policy "auth read energy" on public.energy_records for select to authenticated using (true);

-- Biogas records
create table public.biogas_records (
  id bigserial primary key,
  farm_id uuid not null references public.farms(id) on delete cascade,
  gas_m3 numeric default 0,
  waste_kg numeric default 0,
  fertilizer_kg numeric default 0,
  efficiency_pct numeric default 0,
  created_at timestamptz not null default now()
);
create index on public.biogas_records (farm_id, created_at desc);
grant select, insert on public.biogas_records to authenticated;
grant all on public.biogas_records to service_role;
alter table public.biogas_records enable row level security;
create policy "auth read biogas" on public.biogas_records for select to authenticated using (true);

-- Auto profile + default role on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  insert into public.user_roles (user_id, role)
    values (new.id, coalesce((new.raw_user_meta_data->>'role')::app_role, 'worker'::app_role));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Realtime
alter publication supabase_realtime add table public.sensor_readings;
alter publication supabase_realtime add table public.alerts;
alter publication supabase_realtime add table public.devices;
alter publication supabase_realtime add table public.energy_records;
