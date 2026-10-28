import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query, queryOne } from "../db.server";
import {
  coopControlsSchema,
  DEFAULT_COOP_CONTROLS,
  type CoopControls,
  type CoopZoneState,
} from "../controls";
import { requireManager, requireUser } from "./middleware";
import { FRESHNESS_MS } from "./types";

// Remote control of unit 2, the ESP32 coop controller (firmware/coop_unit).
// Each change bumps a version; the coop picks it up on its next check-in
// (about every 10 s) and reports back the version it applied. Accounts only
// see and change their own coops.

export interface CoopUnit {
  id: string;
  device_id: string;
  house_name: string | null;
  firmware_version: string | null;
  last_seen: string | null;
  last_rssi: number | null;
  online: boolean;
  latest: {
    created_at: string;
    zones: Record<string, CoopZoneState> | null;
    water_turbidity_v: number | null;
    water_ok: boolean | null;
  } | null;
  controls: {
    config: CoopControls;
    version: number;
    applied_version: number | null;
    applied_at: string | null;
    updated_by_name: string | null;
  };
  log: {
    id: number;
    version: number;
    summary: string;
    created_at: string;
    user_name: string | null;
  }[];
}

export const listCoops = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const devices = await query<Omit<CoopUnit, "online" | "latest" | "controls" | "log">>(
      `select d.id, d.device_id, h.name as house_name, d.firmware_version, d.last_seen, d.last_rssi
         from devices d left join poultry_houses h on h.id = d.house_id
        where d.owner_id = $1 and d.unit = 'coop'
        order by d.created_at`,
      [context.user.id],
    );
    return Promise.all(
      devices.map(async (d): Promise<CoopUnit> => {
        const [latest, controls, log] = await Promise.all([
          queryOne<CoopUnit["latest"]>(
            `select created_at, zones, water_turbidity_v, water_ok from sensor_readings
              where device_id = $1 order by created_at desc limit 1`,
            [d.id],
          ),
          queryOne<CoopUnit["controls"]>(
            `select c.config, c.version, c.applied_version, c.applied_at, u.full_name as updated_by_name
               from device_controls c left join users u on u.id = c.updated_by
              where c.device_id = $1`,
            [d.id],
          ),
          query<CoopUnit["log"][number]>(
            `select l.id, l.version, l.change->>'summary' as summary, l.created_at, u.full_name as user_name
               from control_log l left join users u on u.id = l.user_id
              where l.device_id = $1 order by l.created_at desc limit 8`,
            [d.id],
          ),
        ]);
        return {
          ...d,
          online: !!d.last_seen && Date.now() - new Date(d.last_seen).getTime() < FRESHNESS_MS.live,
          latest,
          // Before its first check-in the coop runs its built-in settings.
          controls: controls ?? {
            config: DEFAULT_COOP_CONTROLS,
            version: 0,
            applied_version: null,
            applied_at: null,
            updated_by_name: null,
          },
          log,
        };
      }),
    );
  });

/** One line per change, e.g. "Layers: manual, fan on" or "Broilers fan on above 24 → 26 °C". */
function describeChange(before: CoopControls, after: CoopControls) {
  const parts: string[] = [];
  const name = { layers: "Layers", broilers: "Broilers" } as const;
  const label = {
    high_temp: "fan on above",
    fan_off_temp: "fan off at",
    lamp_off_temp: "lamp off at",
    low_temp: "lamp on below",
  } as const;
  for (const zone of ["layers", "broilers"] as const) {
    const a = before.zones[zone];
    const b = after.zones[zone];
    const bits: string[] = [];
    if (a.mode !== b.mode) bits.push(b.mode === "manual" ? "manual" : "auto");
    if (b.mode === "manual" && (a.fan !== b.fan || a.mode !== b.mode))
      bits.push(`fan ${b.fan ? "on" : "off"}`);
    if (b.mode === "manual" && (a.lamp !== b.lamp || a.mode !== b.mode))
      bits.push(`lamp ${b.lamp ? "on" : "off"}`);
    for (const k of Object.keys(label) as (keyof typeof label)[]) {
      if (a[k] !== b[k]) bits.push(`${label[k]} ${a[k]} → ${b[k]} °C`);
    }
    if (bits.length) parts.push(`${name[zone]}: ${bits.join(", ")}`);
  }
  if (before.water.bad_v !== after.water.bad_v || before.water.good_v !== after.water.good_v) {
    parts.push(`Water: dirty below ${after.water.bad_v} V, clean above ${after.water.good_v} V`);
  }
  return parts.join("; ") || "No change";
}

export const updateCoopControls = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(z.object({ deviceId: z.string().uuid(), config: coopControlsSchema }))
  .handler(async ({ data, context }) => {
    const own = await queryOne(
      "select 1 from devices where id = $1 and owner_id = $2 and unit = 'coop'",
      [data.deviceId, context.user.id],
    );
    if (!own) throw new Error("Coop unit not found");
    const current = await queryOne<{ config: CoopControls }>(
      "select config from device_controls where device_id = $1",
      [data.deviceId],
    );
    const summary = describeChange(current?.config ?? DEFAULT_COOP_CONTROLS, data.config);
    const row = await queryOne<{ version: number }>(
      `insert into device_controls (device_id, config, version, updated_by, updated_at)
       values ($1, $2, 1, $3, now())
       on conflict (device_id) do update
         set config = excluded.config, version = device_controls.version + 1,
             updated_by = excluded.updated_by, updated_at = now()
       returning version`,
      [data.deviceId, JSON.stringify(data.config), context.user.id],
    );
    await query(
      "insert into control_log (device_id, user_id, change, version) values ($1, $2, $3, $4)",
      [
        data.deviceId,
        context.user.id,
        JSON.stringify({ summary, config: data.config }),
        row!.version,
      ],
    );
    return { version: row!.version, summary };
  });
