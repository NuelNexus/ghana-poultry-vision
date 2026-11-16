import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "../db.server";
import { relayState, type RelayState } from "../relays";
import {
  DEFAULT_INCUBATOR_TARGETS,
  INCUBATOR_PRESET_IDS,
  incubatorPresetFor,
  incubatorTargets,
  type CoopPresetId,
  type IncubatorTargets,
  type Reading,
} from "../presets";
import { requireManager, requireUser } from "./middleware";
import { applyRelays } from "../device-commands.server";

// The incubator relay board (firmware/relay_board) on the Automation page.
// Each change bumps a version; the board picks it up on its next check-in and
// reports back which relays are on. Accounts only see and switch their own boards.

export interface RelayBoard {
  id: string;
  device_id: string;
  house_name: string | null;
  firmware_version: string | null;
  last_seen: string | null;
  online: boolean;
  desired: RelayState;
  version: number;
  reported: RelayState | null;
  reported_version: number | null;
  reported_at: string | null;
  updated_at: string | null;
  updated_by_name: string | null;
  /** Latest DHT22 reading (GPIO 14) and when it came in; null before firmware 1.1. */
  reading: Reading | null;
  reading_at: string | null;
  /** Band the reading is checked against. */
  targets: IncubatorTargets;
  /** Last 6 h, one point a minute. */
  history: { t: string; temp: number; humidity: number | null }[];
}

// The board checks in every 1.5 s while watched and every 15 s otherwise.
const ONLINE_MS = 45_000;

type Row = Omit<RelayBoard, "online" | "desired" | "reported" | "targets" | "history"> & {
  desired: unknown;
  reported: unknown;
  targets: IncubatorTargets | null;
};

export const listRelayBoards = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const rows = await query<Row>(
      `select d.id, d.device_id, h.name as house_name, d.firmware_version, d.last_seen,
              r.desired, coalesce(r.version, 0) as version,
              r.reported, r.reported_version, r.reported_at, r.updated_at,
              u.full_name as updated_by_name, r.reading, r.reading_at, r.targets
         from devices d
         left join poultry_houses h on h.id = d.house_id
         left join relay_boards r on r.device_id = d.id
         left join users u on u.id = r.updated_by
        where d.owner_id = $1 and d.type = 'relay'
        order by d.created_at`,
      [context.user.id],
    );
    // Someone is looking: ask the boards to check in quickly for the next 45 s.
    if (rows.length)
      await query(
        `insert into relay_boards (device_id, watched_until)
           select unnest($1::uuid[]), now() + interval '45 seconds'
         on conflict (device_id) do update set watched_until = excluded.watched_until`,
        [rows.map((r) => r.id)],
      );
    const hist = rows.length
      ? await query<{ device_id: string; t: string; temp: number; humidity: number | null }>(
          `select device_id, created_at as t, temp, humidity from relay_readings
            where device_id = any($1::uuid[]) and created_at > now() - interval '6 hours'
            order by created_at`,
          [rows.map((r) => r.id)],
        )
      : [];
    // Boards without their own band follow the bird the farmer picked at sign-up.
    const preset = context.user.poultry_preset as CoopPresetId | null;
    const fallback = preset
      ? incubatorTargets(incubatorPresetFor(preset))
      : DEFAULT_INCUBATOR_TARGETS;
    return rows.map((r): RelayBoard => ({
      ...r,
      targets: r.targets ?? fallback,
      history: hist
        .filter((h) => h.device_id === r.id)
        .map(({ t, temp, humidity }) => ({ t, temp, humidity })),
      desired: relayState(r.desired),
      reported: r.reported ? relayState(r.reported) : null,
      online: !!r.last_seen && Date.now() - new Date(r.last_seen).getTime() < ONLINE_MS,
    }));
  });

const optionalBool = z.boolean().optional();

export const setRelays = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      // Only the relays to change; the others keep their state.
      state: z.object({
        incubator: optionalBool,
        fan: optionalBool,
        light: optionalBool,
        strip: optionalBool,
      }),
    }),
  )
  .handler(({ data, context }) => applyRelays(context.user.id, data.id, data.state));

const band = z.number().min(0).max(100);

/** The incubator's temperature/humidity band: an incubator preset, or custom values. */
export const setIncubatorTargets = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator(
    z
      .object({
        id: z.string().uuid(),
        preset: z.enum(["custom", ...INCUBATOR_PRESET_IDS] as [string, ...string[]]),
        temp_low: z.number().min(30).max(42),
        temp_high: z.number().min(30).max(42),
        rh_low: band,
        rh_high: band,
      })
      .refine((t) => t.temp_low < t.temp_high && t.rh_low < t.rh_high, {
        message: "The low value must be below the high value",
      }),
  )
  .handler(async ({ data, context }) => {
    const { id, ...targets } = data;
    const row = await query(
      `insert into relay_boards (device_id, targets)
         select d.id, $2 from devices d where d.id = $1 and d.owner_id = $3 and d.type = 'relay'
       on conflict (device_id) do update set targets = excluded.targets
       returning device_id`,
      [id, JSON.stringify(targets), context.user.id],
    );
    if (!row.length) throw new Error("Relay board not found");
    return targets;
  });
