-- Each account is its own farm. Devices and cameras record who registered
-- them, and every page only shows the signed-in account's farms, devices,
-- cameras, readings, alerts and hatchery batches (src/lib/api/farm.functions.ts).

alter table devices add column if not exists owner_id uuid references users(id) on delete cascade;
alter table cameras add column if not exists owner_id uuid references users(id) on delete cascade;
create index if not exists devices_owner_idx on devices (owner_id);
create index if not exists cameras_owner_idx on cameras (owner_id);
create index if not exists farms_owner_idx on farms (owner_id);

-- Until now only the first admin could register anything, so existing farms,
-- devices and cameras without an owner belong to that account.
update farms set owner_id = (
  select r.user_id from user_roles r join users u on u.id = r.user_id
   where r.role = 'admin' order by u.created_at limit 1)
 where owner_id is null;
update devices d set owner_id = coalesce(
  (select f.owner_id from farms f where f.id = d.farm_id),
  (select r.user_id from user_roles r join users u on u.id = r.user_id
    where r.role = 'admin' order by u.created_at limit 1))
 where owner_id is null;
update cameras c set owner_id = coalesce(
  (select f.owner_id from farms f where f.id = c.farm_id),
  (select r.user_id from user_roles r join users u on u.id = r.user_id
    where r.role = 'admin' order by u.created_at limit 1))
 where owner_id is null;

-- Every account manages its own farm now, so nobody is left as a worker.
insert into user_roles (user_id, role) select id, 'admin' from users on conflict do nothing;
delete from user_roles where role = 'worker';
