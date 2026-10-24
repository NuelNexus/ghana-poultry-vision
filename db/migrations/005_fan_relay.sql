-- The Pi now switches the fan through a relay: it is either on or off. There
-- is no PWM duty and no tach, so fan_rpm and fan_duty are no longer written.

alter table sensor_readings add column if not exists fan_on boolean;

-- Older readings: the fan was running if the PWM duty was above stall (0.12).
update sensor_readings set fan_on = fan_duty >= 0.12
 where fan_on is null and fan_duty is not null;
update sensor_readings
   set fan_level = case when fan_on then 'on' else 'off' end
 where fan_level in ('low', 'medium', 'high') and fan_on is not null;

-- Manager overrides become on / off. "Low" was minimum ventilation, so it maps to off.
alter table devices drop constraint if exists devices_fan_override_check;
update devices set fan_override = case when fan_override = 'low' then 'off' else 'on' end
 where fan_override in ('low', 'medium', 'high');
alter table devices add constraint devices_fan_override_check check (fan_override in ('on', 'off'));

-- Old alert text from the PWM agent.
update alerts set message = replace(replace(replace(message,
         'Fan set to low.', 'Fan is off.'),
         'Fan set to medium.', 'Fan switched on.'),
         'Fan set to high.', 'Fan switched on.')
 where message like '%Fan set to %';
