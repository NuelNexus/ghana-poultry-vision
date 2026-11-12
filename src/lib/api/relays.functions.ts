import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query, queryOne } from "../db.server";
import { relayState, type RelayState } from "../relays";
import { requireManager, requireUser } from "./middleware";

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
}

// The board checks in every 1.5 s while watched and every 15 s otherwise.
const ONLINE_MS = 45_000;

type Row = Omit<RelayBoard, "online" | "desired" | "reported"> & {
  desired: unknown;
  reported: unknown;
};

export const listRelayBoards = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const rows = await query<Row>(
      `select d.id, d.device_id, h.name as house_name, d.firmware_version, d.last_seen,
              r.desired, coalesce(r.version, 0) as version,
              r.reported, r.reported_version, r.reported_at, r.updated_at,
              u.full_name as updated_by_name
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
    return rows.map((r): RelayBoard => ({
      ...r,
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
  .handler(async ({ data, context }) => {
    const own = await queryOne(
      "select 1 from devices where id = $1 and owner_id = $2 and type = 'relay'",
      [data.id, context.user.id],
    );
    if (!own) throw new Error("Relay board not found");
    const patch = Object.fromEntries(Object.entries(data.state).filter(([, v]) => v !== undefined));
    const row = await queryOne<{ desired: unknown; version: number }>(
      `insert into relay_boards (device_id, desired, version, updated_by, updated_at, watched_until)
         values ($1, '{"incubator": true, "fan": true, "light": true, "strip": true}'::jsonb || $2::jsonb,
                 2, $3, now(), now() + interval '45 seconds')
       on conflict (device_id) do update
         set desired = relay_boards.desired || $2::jsonb, version = relay_boards.version + 1,
             updated_by = $3, updated_at = now(), watched_until = now() + interval '45 seconds'
       returning desired, version`,
      [data.id, JSON.stringify(patch), context.user.id],
    );
    return { desired: relayState(row!.desired), version: row!.version };
  });
