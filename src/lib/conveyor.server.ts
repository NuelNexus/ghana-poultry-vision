import { query, queryOne } from "./db.server";
import { DEFAULT_COOP_CONTROLS } from "./controls";
import { describeConveyor, type ConveyorDir } from "./conveyor";

/**
 * Send the feeder belt one of the user's coops a command: left / right for `seconds`, or
 * stop. Throws if the coop isn't theirs. The coop picks it up within about 2 s.
 */
export async function sendConveyor(
  userId: string,
  deviceId: string,
  dir: ConveyorDir,
  seconds: number,
) {
  const own = await queryOne(
    "select 1 from devices where id = $1 and owner_id = $2 and unit = 'coop'",
    [deviceId, userId],
  );
  if (!own) throw new Error("Coop unit not found");
  const row = await queryOne<{ id: number; version: number }>(
    `insert into device_controls (device_id, config, version, conveyor, conveyor_at)
       values ($1, $2, 1, jsonb_build_object('id', 1, 'dir', $3::text, 'seconds', $4::int), now())
     on conflict (device_id) do update
       set conveyor = jsonb_build_object(
             'id', coalesce((device_controls.conveyor->>'id')::int, 0) + 1,
             'dir', $3::text, 'seconds', $4::int),
           conveyor_at = now()
     returning (conveyor->>'id')::int as id, version`,
    [deviceId, JSON.stringify(DEFAULT_COOP_CONTROLS), dir, seconds],
  );
  const summary = describeConveyor(dir, seconds);
  await query(
    "insert into control_log (device_id, user_id, change, version) values ($1, $2, $3, $4)",
    [deviceId, userId, JSON.stringify({ summary, conveyor: { dir, seconds } }), row!.version],
  );
  return { id: row!.id, summary };
}
