-- Which way up a camera is mounted. 180 is done in the camera's sensor (firmware/esp32cam
-- flips the picture, so every viewer gets it upright); 90 and 270 are turned by the
-- browser and the vision worker, since the sensor can only flip.
alter table cameras add column if not exists rotation smallint not null default 0;
alter table cameras drop constraint if exists cameras_rotation_check;
alter table cameras add constraint cameras_rotation_check check (rotation in (0, 90, 180, 270));
