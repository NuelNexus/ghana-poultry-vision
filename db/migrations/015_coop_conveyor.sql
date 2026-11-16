-- The coop's feeder conveyor belt: two motors (one at each end) on an H-bridge, run left or
-- right for a set time from the Automation page or by Ama. The command is kept apart from
-- the versioned zone settings: the coop polls it every 2 s (/api/public/devices/conveyor),
-- so a press reaches the belt quickly. Each new command gets a new id, so pressing "Left"
-- twice runs it twice.
alter table device_controls add column if not exists conveyor jsonb;           -- {id, dir, seconds}
alter table device_controls add column if not exists conveyor_at timestamptz;  -- when it was sent
alter table device_controls add column if not exists conveyor_state jsonb;     -- what the coop reports
alter table device_controls add column if not exists conveyor_state_at timestamptz;
