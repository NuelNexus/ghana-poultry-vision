import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { query, queryOne } from "@/lib/db.server";
import { CONVEYOR_DIRS } from "@/lib/conveyor";

// The coop unit (firmware/coop_unit) polls this about every 2 s for its feeder belt.
// Headers: x-device-id, x-api-key
// Body:    { state?: {dir, remaining_s, cmd_id} }   what the belt is doing now
// Reply:   { id, dir, seconds, age_s }   the latest command ({ id: 0 } if none yet)
//   The coop runs a command once, when its id is new to it, and only if it is fresh
//   (age_s small), so a coop that restarts never replays an old run.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const bodySchema = z
  .object({
    state: z
      .object({
        dir: z.enum(CONVEYOR_DIRS),
        remaining_s: z.number().min(0).max(1000),
        cmd_id: z.number().int(),
      })
      .optional(),
  })
  .nullable();

export const Route = createFileRoute("/api/public/devices/conveyor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const deviceId = request.headers.get("x-device-id");
        const apiKey = request.headers.get("x-api-key");
        if (!deviceId || !apiKey) return json({ error: "Missing device credentials" }, 401);
        const device = await queryOne<{ id: string; api_key: string; unit: string | null }>(
          "select id, api_key, unit from devices where device_id = $1",
          [deviceId],
        );
        if (!device || !sameKey(device.api_key, apiKey))
          return json({ error: "Unauthorized" }, 401);

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        const state = parsed.success ? parsed.data?.state : undefined;
        const row = await queryOne<{
          conveyor: { id: number; dir: string; seconds: number } | null;
          age_s: number | null;
        }>(
          state
            ? `update device_controls set conveyor_state = $2, conveyor_state_at = now()
                where device_id = $1
                returning conveyor, extract(epoch from now() - conveyor_at)::float as age_s`
            : `select conveyor, extract(epoch from now() - conveyor_at)::float as age_s
                 from device_controls where device_id = $1`,
          state ? [device.id, JSON.stringify(state)] : [device.id],
        );
        await query("update devices set last_seen = now() where id = $1", [device.id]);
        const c = row?.conveyor;
        return json(
          c ? { id: c.id, dir: c.dir, seconds: c.seconds, age_s: Math.round(row!.age_s ?? 0) } : { id: 0 },
        );
      },
    },
  },
});

function sameKey(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
