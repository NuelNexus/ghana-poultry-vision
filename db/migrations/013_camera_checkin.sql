-- ESP32-CAMs running firmware/esp32cam check in with the site every minute and
-- report their IP, so a camera keeps working when the router gives it a new address.
-- Such a camera gets its own device row (type 'camera', with an API key) linked here;
-- cameras added by a fixed stream URL (stock CameraWebServer firmware) have none.
alter table cameras add column if not exists device_id uuid references devices(id) on delete set null;
create unique index if not exists cameras_device_idx on cameras (device_id) where device_id is not null;
