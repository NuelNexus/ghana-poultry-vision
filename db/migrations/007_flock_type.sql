-- Broilers or layers, so Ama and the flock care card can follow the right
-- vaccination schedule (src/lib/vaccine-schedule.ts). Null = not chosen yet.

alter table poultry_houses add column if not exists flock_type text;
alter table poultry_houses drop constraint if exists poultry_houses_flock_type_check;
alter table poultry_houses add constraint poultry_houses_flock_type_check
  check (flock_type in ('broiler', 'layer'));

-- Existing houses: guess from the batch name where it says so.
update poultry_houses set flock_type = 'layer'
 where flock_type is null and batch_name ilike '%layer%';
update poultry_houses set flock_type = 'broiler'
 where flock_type is null and batch_name ilike '%broiler%';

-- One "vaccine day" alert per house per day (see getFlockCare).
create index if not exists alerts_house_type_idx on alerts (house_id, type, created_at desc);
