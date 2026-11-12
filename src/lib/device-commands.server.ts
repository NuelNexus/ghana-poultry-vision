import { query, queryOne } from "./db.server";
import { DEFAULT_COOP_CONTROLS, type CoopControls, type CoopZone } from "./controls";
import { relayState, type RelayName, type RelayState } from "./relays";
import { chatCompletion, localModel } from "./openai.server";
import type { Role } from "./auth.server";

// Switching the farm's devices, shared by the Automation page and Ama.
//   applyCoopControls  new settings for a coop unit (firmware/coop_unit picks them up)
//   applyRelays        switch relays on an incubator relay board (firmware/relay_board)
//   runDeviceCommands  read a farmer's message ("turn on the incubator fan", "dum kanea no")
//                      and carry out any switching it asks for, for Ama to confirm

export const MANAGER_ROLES: Role[] = ["admin", "manager"];

/** One line per change, e.g. "Layers: manual, fan on" or "Broilers fan on above 24 → 26 °C". */
export function describeChange(before: CoopControls, after: CoopControls) {
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

/** Save new settings for one of the user's coop units. Throws if it isn't theirs. */
export async function applyCoopControls(userId: string, deviceId: string, config: CoopControls) {
  const own = await queryOne(
    "select 1 from devices where id = $1 and owner_id = $2 and unit = 'coop'",
    [deviceId, userId],
  );
  if (!own) throw new Error("Coop unit not found");
  const current = await queryOne<{ config: CoopControls }>(
    "select config from device_controls where device_id = $1",
    [deviceId],
  );
  const summary = describeChange(current?.config ?? DEFAULT_COOP_CONTROLS, config);
  const row = await queryOne<{ version: number }>(
    `insert into device_controls (device_id, config, version, updated_by, updated_at)
     values ($1, $2, 1, $3, now())
     on conflict (device_id) do update
       set config = excluded.config, version = device_controls.version + 1,
           updated_by = excluded.updated_by, updated_at = now()
     returning version`,
    [deviceId, JSON.stringify(config), userId],
  );
  await query(
    "insert into control_log (device_id, user_id, change, version) values ($1, $2, $3, $4)",
    [deviceId, userId, JSON.stringify({ summary, config }), row!.version],
  );
  return { version: row!.version, summary };
}

/** Switch relays on one of the user's relay boards; the others keep their state. */
export async function applyRelays(userId: string, boardId: string, patch: Partial<RelayState>) {
  const own = await queryOne(
    "select 1 from devices where id = $1 and owner_id = $2 and type = 'relay'",
    [boardId, userId],
  );
  if (!own) throw new Error("Relay board not found");
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const row = await queryOne<{ desired: unknown; version: number }>(
    `insert into relay_boards (device_id, desired, version, updated_by, updated_at, watched_until)
       values ($1, '{"incubator": true, "fan": true, "light": true, "strip": true}'::jsonb || $2::jsonb,
               2, $3, now(), now() + interval '45 seconds')
     on conflict (device_id) do update
       set desired = relay_boards.desired || $2::jsonb, version = relay_boards.version + 1,
           updated_by = $3, updated_at = now(), watched_until = now() + interval '45 seconds'
     returning desired, version`,
    [boardId, JSON.stringify(clean), userId],
  );
  return { desired: relayState(row!.desired), version: row!.version };
}

/* -------------------------------------------------------------------------- */
/* Commands from a conversation with Ama                                       */
/* -------------------------------------------------------------------------- */

// Cheap first check so ordinary questions don't cost an extra model call. English,
// Twi (bue = open / switch on, dum = switch off, kanea = light, mframa = air / fan)
// and a few other words for the devices.
const MAYBE_COMMAND =
  /\b(on|off|turn|switch|start|stop|open|close|shut|enable|disable|power|bue|dum|kanea|mframa|fan|fans|lamp|lamps|light|lights|heat|heater|strip|led|incubator|brooder|coop|auto|manual|allume|éteins|eteins|ventilateur)\b/i;

type Part = "heat" | "fan" | "lamp" | "strip" | "everything" | "auto";
type Command = {
  unit: "incubator" | "coop" | "unclear";
  part: Part;
  zone: "layers" | "broilers" | "both";
  on: boolean;
};

const commandSchema = {
  name: "device_commands",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["commands"],
    properties: {
      commands: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["unit", "part", "zone", "on"],
          properties: {
            unit: { type: "string", enum: ["incubator", "coop", "unclear"] },
            part: { type: "string", enum: ["heat", "fan", "lamp", "strip", "everything", "auto"] },
            zone: { type: "string", enum: ["layers", "broilers", "both"] },
            on: { type: "boolean" },
          },
        },
      },
    },
  },
};

export interface CommandResult {
  /** What was switched, in plain English, for Ama to confirm. */
  done: string[];
  /** What couldn't be done and why, for Ama to explain. */
  problems: string[];
}

const RELAY_FOR: Record<"heat" | "fan" | "lamp" | "strip", RelayName> = {
  heat: "incubator",
  fan: "fan",
  lamp: "light",
  strip: "strip",
};
const RELAY_WORD: Record<RelayName, string> = {
  incubator: "heat (incubator controller)",
  fan: "fan",
  light: "lamp",
  strip: "strip lights",
};

/**
 * Carry out any device switching the farmer asks for in this message. Returns null
 * when the message asks for none (most messages), so Ama just answers.
 */
export async function runDeviceCommands(opts: {
  userId: string;
  roles: Role[];
  text: string;
  /** English translation of the message, when there is one. */
  english?: string | null;
  /** Twi / other Ghanaian language: use the model that reads them well. */
  local?: boolean;
}): Promise<CommandResult | null> {
  const said = [opts.text, opts.english].filter(Boolean).join("\n");
  if (!said.trim() || !MAYBE_COMMAND.test(said)) return null;

  const [boards, coops] = await Promise.all([
    query<{ id: string; device_id: string; online: boolean }>(
      `select id, device_id, coalesce(last_seen > now() - interval '45 seconds', false) as online
         from devices where owner_id = $1 and type = 'relay'
        order by (last_seen > now() - interval '45 seconds') desc nulls last, created_at`,
      [opts.userId],
    ),
    query<{ id: string; device_id: string; online: boolean; config: CoopControls | null }>(
      `select d.id, d.device_id, coalesce(d.last_seen > now() - interval '90 seconds', false) as online,
              c.config
         from devices d left join device_controls c on c.device_id = d.id
        where d.owner_id = $1 and d.unit = 'coop'
        order by (d.last_seen > now() - interval '90 seconds') desc nulls last, d.created_at`,
      [opts.userId],
    ),
  ]);

  let commands: Command[] = [];
  try {
    const raw = await chatCompletion(
      [
        {
          role: "system",
          content: `You turn a poultry farmer's message into device switching commands. Reply with JSON only.
The farm can have two units:
- The incubator unit${boards.length ? "" : " (NOT registered on this farm)"}: a white box with an incubator on top
  and a brooding area below. Parts: "heat" (the incubator controller / heater), "fan" (in the incubator),
  "lamp" (the lamp in the incubator), "strip" (LED strip lights in the brooding area).
- The coop${coops.length ? "" : " (NOT registered on this farm)"}: two zones, "layers" and "broilers". Each zone has a "fan"
  and a heat "lamp". A zone runs on Auto (its own thermostat) or Manual.
Rules:
- Only give commands when the farmer clearly asks to switch something on or off now (in any language,
  e.g. Twi "bue" = switch on / open, "dum" = switch off, "kanea" = light / lamp). Questions, advice requests
  and statements give no commands: {"commands": []}.
- "on": true to switch on, false to switch off.
- "everything" = all parts of that unit. "auto" (coop only) = hand that zone back to its thermostat; "on" is then true.
- heat and strip exist only on the incubator. If the farmer says incubator, brooder or chicks, use "incubator";
  coop, layers, broilers or hens, use "coop".
- If the unit isn't said: use the only registered unit that has that part; if both could be meant, "unclear".
- Coop zone: the one named, else "both". For the incubator use "both".`,
        },
        { role: "user", content: said },
      ],
      { jsonSchema: commandSchema, maxTokens: 300, model: opts.local ? localModel() : undefined },
    );
    commands = (JSON.parse(raw) as { commands: Command[] }).commands;
  } catch {
    return null; // no model or it failed: Ama answers as usual
  }
  if (!commands.length) return null;

  const done: string[] = [];
  const problems: string[] = [];
  if (!opts.roles.some((r) => MANAGER_ROLES.includes(r))) {
    problems.push(
      "This account can't switch devices: only admins and farm managers can. Nothing was changed.",
    );
    return { done, problems };
  }

  // Incubator: one relay update for all its parts.
  const relayPatch: Partial<RelayState> = {};
  // Coop: fold every change into the current settings, then save once.
  const coop = coops[0];
  let config: CoopControls | null = coop
    ? structuredClone(coop.config ?? DEFAULT_COOP_CONTROLS)
    : null;
  let coopChanged = false;

  for (const c of commands) {
    if (c.unit === "unclear") {
      problems.push(
        `Not sure whether "${c.part}" means the incubator or the coop, so nothing was switched for it. Ask which one.`,
      );
      continue;
    }
    if (c.unit === "incubator") {
      if (!boards.length) {
        problems.push("No incubator relay board is registered on this farm.");
        continue;
      }
      if (c.part === "auto") continue;
      const names: RelayName[] =
        c.part === "everything" ? ["incubator", "fan", "light", "strip"] : [RELAY_FOR[c.part]];
      for (const n of names) relayPatch[n] = c.on;
      continue;
    }
    // Coop
    if (!coop || !config) {
      problems.push("No coop unit is registered on this farm.");
      continue;
    }
    if (c.part === "heat" || c.part === "strip") {
      problems.push(`The coop has no ${c.part === "heat" ? "heater" : "strip lights"}.`);
      continue;
    }
    const zones: CoopZone[] = c.zone === "both" ? ["layers", "broilers"] : [c.zone];
    for (const z of zones) {
      const cur = config.zones[z];
      if (c.part === "auto") {
        config.zones[z] = { ...cur, mode: "auto", fan: false, lamp: false };
      } else if (c.part === "everything") {
        // Fan and lamp never run together: "everything on" means the fan.
        config.zones[z] = { ...cur, mode: "manual", fan: c.on, lamp: false };
      } else if (c.part === "fan") {
        config.zones[z] = { ...cur, mode: "manual", fan: c.on, lamp: c.on ? false : cur.lamp };
      } else {
        config.zones[z] = { ...cur, mode: "manual", lamp: c.on, fan: c.on ? false : cur.fan };
      }
      coopChanged = true;
    }
  }

  if (Object.keys(relayPatch).length) {
    const board = boards[0];
    try {
      await applyRelays(opts.userId, board.id, relayPatch);
      const list = Object.entries(relayPatch)
        .map(([k, v]) => `${RELAY_WORD[k as RelayName]} ${v ? "on" : "off"}`)
        .join(", ");
      done.push(
        `Incubator unit ${board.device_id}: ${list}.` +
          (board.online ? "" : " The board is offline, so it switches when it reconnects."),
      );
    } catch (e) {
      problems.push(`Couldn't switch the incubator: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (coop && config && coopChanged) {
    try {
      const { summary } = await applyCoopControls(opts.userId, coop.id, config);
      done.push(
        `Coop ${coop.device_id}: ${summary}. In each zone the fan and the lamp never run together, so switching one on switches the other off.` +
          (coop.online ? "" : " The coop is offline, so it switches when it reconnects."),
      );
    } catch (e) {
      problems.push(`Couldn't switch the coop: ${e instanceof Error ? e.message : e}`);
    }
    config = null;
  }
  return { done, problems };
}

/** The result as a short note for Ama's instructions, so her reply confirms it. */
export function commandNote(r: CommandResult | null) {
  if (!r) return "";
  const lines = [
    ...r.done.map((d) => `- Done: ${d}`),
    ...r.problems.map((p) => `- Not done: ${p}`),
  ];
  return `

DEVICE ACTIONS: the app has just acted on the farmer's last message:
${lines.join("\n")}
Confirm briefly what was switched (and explain anything not done). Don't say you can't control devices.`;
}
