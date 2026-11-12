import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { query, queryOne } from "@/lib/db.server";
import { relayState, relayStateSchema } from "@/lib/relays";

// The incubator relay board (firmware/relay_board) checks in here.
// Headers: x-device-id, x-api-key
// Body:    { state: {incubator, fan, light, strip}, version, local?, firmware?, rssi? }
//   state    what its relays are now
//   version  the settings version it last applied
//   local    true when someone switched a relay on the board's own web page since the
//            last check-in: the site adopts that state, so both stay in sync
// Reply:   { desired: {...}, version, next_ms }
//   The board switches to "desired" whenever "version" is newer than its own, then checks
//   in again after next_ms: 1.5 s while someone has Automation open, else 15 s.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const bodySchema = z.object({
  state: relayStateSchema.partial(),
  version: z.number().int().optional(),
  local: z.boolean().optional(),
  firmware: z.string().max(40).optional(),
  rssi: z.number().int().optional(),
});

export const Route = createFileRoute("/api/public/devices/relays")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const deviceId = request.headers.get("x-device-id");
        const apiKey = request.headers.get("x-api-key");
        if (!deviceId || !apiKey) return json({ error: "Missing device credentials" }, 401);
        const device = await queryOne<{ id: string; api_key: string; type: string }>(
          "select id, api_key, type from devices where device_id = $1",
          [deviceId],
        );
        if (!device || device.api_key !== apiKey) return json({ error: "Unauthorized" }, 401);
        if (device.type !== "relay")
          return json({ error: "This device is not registered as a relay board" }, 400);

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid body" }, 400);
        const b = parsed.data;
        const state = JSON.stringify(relayState(b.state));

        await query(
          `update devices set last_seen = now(), firmware_version = coalesce($2, firmware_version),
                  last_rssi = coalesce($3, last_rssi) where id = $1`,
          [device.id, b.firmware ?? null, b.rssi ?? null],
        );
        await query("insert into relay_boards (device_id) values ($1) on conflict do nothing", [
          device.id,
        ]);
        // Switched on the board's own page: that becomes what the site wants too.
        const row = b.local
          ? await queryOne<{ desired: unknown; version: number; watched: boolean }>(
              `update relay_boards set desired = $2, version = version + 1, updated_by = null,
                      updated_at = now(), reported = $2, reported_version = version + 1,
                      reported_at = now()
                where device_id = $1
               returning desired, version, coalesce(watched_until > now(), false) as watched`,
              [device.id, state],
            )
          : await queryOne<{ desired: unknown; version: number; watched: boolean }>(
              `update relay_boards set reported = $2, reported_version = $3, reported_at = now()
                where device_id = $1
               returning desired, version, coalesce(watched_until > now(), false) as watched`,
              [device.id, state, b.version ?? null],
            );
        return json({
          desired: relayState(row!.desired),
          version: row!.version,
          next_ms: row!.watched ? 1500 : 15000,
        });
      },
    },
  },
});
