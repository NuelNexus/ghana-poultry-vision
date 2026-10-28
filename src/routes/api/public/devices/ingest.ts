import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { query, queryOne } from "@/lib/db.server";
import { DEFAULT_COOP_CONTROLS, type CoopControls } from "@/lib/controls";

// Devices POST readings here:
//   unit 1, incubator & brooder: the Raspberry Pi edge agent (edge/agent.py)
//   unit 2, coop: the ESP32 coop controller (firmware/coop_unit/), which also
//     gets its remote settings ("controls", versioned) back in the response
// The ESP32-CAM is viewed straight from the browser and never posts here.
// Headers: x-device-id, x-api-key
// Body: a single reading, or { "readings": [...] } for a batch (the Pi sends
// its offline backlog this way). Each reading carries DHT22 temperature and
// humidity, the MQ-135 gas index and LDR light level, whether the fan relay is
// on, plus the edge model's output under "ai". Status changes become alerts
// automatically. The response returns the flock age and any fan override
// ("on" / "off") so the Pi picks them up on its next upload.

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-device-id, x-api-key",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });

const num = z
  .preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().finite().nullable())
  .optional();

const aiSchema = z
  .object({
    status: z.enum(["healthy", "warning", "critical"]),
    confidence: num,
    probabilities: z.record(z.number()).optional(),
    causes: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          prob: z.number(),
          advice: z.string().optional(),
        }),
      )
      .max(10)
      .optional(),
    // "on" / "off" from the relay agent; older PWM agents sent low / medium / high.
    fan_level: z.enum(["on", "off", "low", "medium", "high"]).optional(),
    growth_phase: z.string().max(32).optional(),
    target_temp: num,
    model_version: z.string().max(64).optional(),
  })
  .passthrough();

const zoneStateSchema = z
  .object({
    temp: num,
    humidity: num,
    sensor_ok: z.boolean().optional(),
    fan: z.boolean().optional(),
    lamp: z.boolean().optional(),
    mode: z.enum(["auto", "manual"]).optional(),
    safety_tripped: z.boolean().optional(),
  })
  .passthrough();

const readingSchema = z
  .object({
    // Coop unit (firmware/coop_unit): zones, water and the settings version it runs
    unit: z.enum(["brooder", "coop"]).optional(),
    firmware: z.string().max(40).optional(),
    config_version: z.number().int().optional(),
    config_error: z.string().max(200).optional(),
    rssi: z.number().int().optional(),
    zones: z.record(zoneStateSchema).optional(),
    water: z
      .object({ voltage: num, sensor_ok: z.boolean().optional(), good: z.boolean().optional() })
      .passthrough()
      .optional(),
    recorded_at: z.string().datetime({ offset: true }).optional(),
    temperature: num,
    humidity: num,
    gas_index: num,
    light: num,
    fan_on: z.boolean().nullable().optional(),
    fan_duty: num,
    bird_age_days: num,
    ai: aiSchema.optional(),
  })
  .passthrough();

const STATUS_RANK = { healthy: 0, warning: 1, critical: 2 } as const;

export const Route = createFileRoute("/api/public/devices/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const deviceId = request.headers.get("x-device-id");
        const apiKey = request.headers.get("x-api-key");
        if (!deviceId || !apiKey) return json({ error: "Missing device credentials" }, 401);

        const device = await queryOne<{
          id: string;
          api_key: string;
          house_id: string | null;
          farm_id: string | null;
          fan_override: string | null;
          house_name: string | null;
          batch_started_at: string | null;
          unit: "brooder" | "coop" | null;
          type: string;
        }>(
          `select d.id, d.api_key, d.house_id, coalesce(d.farm_id, h.farm_id) as farm_id, d.fan_override,
                  h.name as house_name, h.batch_started_at, d.unit, d.type
             from devices d left join poultry_houses h on h.id = d.house_id
            where d.device_id = $1`,
          [deviceId],
        );
        if (!device || !timingSafeEqual(device.api_key, apiKey))
          return json({ error: "Unauthorized" }, 401);

        const body = (await request.json().catch(() => null)) as unknown;
        const list =
          body &&
          typeof body === "object" &&
          Array.isArray((body as { readings?: unknown }).readings)
            ? (body as { readings: unknown[] }).readings
            : [body];
        if (list.length === 0 || list.length > 200)
          return json({ error: "Send 1-200 readings per request" }, 400);

        const parsed = list.map((r) => readingSchema.safeParse(r));
        const bad = parsed.findIndex((p) => !p.success);
        if (bad >= 0)
          return json(
            { error: `Reading ${bad} is invalid`, issues: parsed[bad].error!.issues.slice(0, 5) },
            400,
          );
        const readings = parsed.map((p) => p.data!);

        const prev = await queryOne<{ ai_status: keyof typeof STATUS_RANK | null }>(
          "select ai_status from sensor_readings where device_id = $1 and ai_status is not null order by created_at desc limit 1",
          [device.id],
        );
        let lastStatus = prev?.ai_status ?? "healthy";
        const prevWater = await queryOne<{ water_ok: boolean | null }>(
          "select water_ok from sensor_readings where device_id = $1 and water_ok is not null order by created_at desc limit 1",
          [device.id],
        );
        let lastWaterOk = prevWater?.water_ok ?? true;
        const now = Date.now();

        for (const r of readings) {
          // Trust the Pi's clock for backlog, but never accept future timestamps.
          const ts =
            r.recorded_at && new Date(r.recorded_at).getTime() <= now + 60_000
              ? r.recorded_at
              : new Date(now).toISOString();
          const ai = r.ai;
          // Coop unit: the zones' average stands in as the reading's temperature and
          // humidity, so the overview, houses and reports work for both units.
          const zoneList = Object.values(r.zones ?? {});
          const avg = (k: "temp" | "humidity") => {
            const v = zoneList.map((zs) => zs[k]).filter((x): x is number => typeof x === "number");
            return v.length
              ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10
              : null;
          };
          const waterOk =
            r.water && r.water.sensor_ok !== false && typeof r.water.good === "boolean"
              ? r.water.good
              : null;
          const fanOn =
            r.fan_on ??
            (r.fan_duty != null
              ? r.fan_duty >= 0.12
              : ai?.fan_level
                ? ai.fan_level !== "off"
                : null);
          await query(
            `insert into sensor_readings (
               device_id, house_id, temperature, humidity, gas_index, light,
               fan_on, bird_age_days, ai_status, ai_confidence, ai_probabilities, ai_causes,
               fan_level, growth_phase, target_temp, model_version, payload, created_at,
               zones, water_turbidity_v, water_ok, config_version)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
            [
              device.id,
              device.house_id,
              r.temperature ?? avg("temp"),
              r.humidity ?? avg("humidity"),
              r.gas_index ?? null,
              r.light ?? null,
              fanOn,
              r.bird_age_days ?? null,
              ai?.status ?? null,
              ai?.confidence ?? null,
              ai?.probabilities ? JSON.stringify(ai.probabilities) : null,
              ai?.causes ? JSON.stringify(ai.causes) : null,
              fanOn == null ? null : fanOn ? "on" : "off",
              ai?.growth_phase ?? null,
              ai?.target_temp ?? null,
              ai?.model_version ?? null,
              JSON.stringify(r),
              ts,
              r.zones ? JSON.stringify(r.zones) : null,
              r.water?.voltage ?? null,
              waterOk,
              r.config_version ?? null,
            ],
          );

          if (waterOk !== null && waterOk !== lastWaterOk) {
            await recordWaterChange(device, deviceId, waterOk);
            lastWaterOk = waterOk;
          }
          for (const [zone, zs] of Object.entries(r.zones ?? {})) {
            if (zs.safety_tripped) {
              await raiseOnce(
                device,
                "device",
                "critical",
                `${device.house_name ?? deviceId}: ${zone} zone overheated, lamp cut off by the safety limit.`,
              );
            }
          }

          if (ai && ai.status !== lastStatus) {
            await recordStatusChange(device, deviceId, lastStatus, ai, fanOn);
            lastStatus = ai.status;
          }
        }

        const latest = readings[readings.length - 1];
        const unit =
          device.unit ??
          latest.unit ??
          (device.type === "pi" ? "brooder" : device.type === "coop" ? "coop" : null);
        await query(
          `update devices set last_seen = now(), online = true,
                  unit = coalesce(unit, $2),
                  firmware_version = coalesce($3, firmware_version),
                  last_rssi = coalesce($4, last_rssi)
            where id = $1`,
          [device.id, unit, latest.firmware ?? null, latest.rssi ?? null],
        );

        let controls: (CoopControls & { version: number }) | undefined;
        if (unit === "coop") {
          controls = await coopControls(device.id, latest.config_version);
          if (latest.config_error) {
            await raiseOnce(
              device,
              "device",
              "warning",
              `${device.house_name ?? deviceId}: the coop rejected new settings (${latest.config_error}).`,
            );
          }
        }

        const age = device.batch_started_at
          ? Math.max(0, Math.floor((now - new Date(device.batch_started_at).getTime()) / 86400_000))
          : null;
        return json({
          ok: true,
          accepted: readings.length,
          config: { bird_age_days: age, fan_override: device.fan_override, controls },
        });
      },
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
    },
  },
});

async function recordStatusChange(
  device: {
    id: string;
    farm_id: string | null;
    house_id: string | null;
    house_name: string | null;
  },
  deviceCode: string,
  from: keyof typeof STATUS_RANK,
  ai: z.infer<typeof aiSchema>,
  fanOn: boolean | null,
) {
  const where = device.house_name ?? deviceCode;
  if (ai.status === "healthy") {
    // Conditions recovered: close this device's open AI alerts.
    await query(
      "update alerts set resolved = true where device_id = $1 and type = 'ai' and not coalesce(resolved, false)",
      [device.id],
    );
    return;
  }
  if (STATUS_RANK[ai.status] < STATUS_RANK[from]) return; // easing from critical to warning: keep the open alert
  const causes = (ai.causes ?? []).map((c) => c.label).join(", ") || "conditions drifting";
  const fan = fanOn == null ? "" : fanOn ? " Fan switched on." : " Fan is off.";
  const message = `${where}: ${ai.status === "critical" ? "CRITICAL" : "Warning"}: ${causes}.${fan}`;
  // Conditions hovering around a threshold: reopen the recent alert instead of
  // stacking up a new one every few minutes.
  const reopened = await query(
    `update alerts set resolved = false, message = $3, created_at = now()
      where id = (select id from alerts
                   where device_id = $1 and type = 'ai' and severity = $2
                     and created_at > now() - interval '15 minutes'
                   order by created_at desc limit 1)
      returning id`,
    [device.id, ai.status, message],
  );
  if (reopened.length) return;
  await query(
    "insert into alerts (farm_id, house_id, device_id, severity, type, message) values ($1,$2,$3,$4,'ai',$5)",
    [device.farm_id, device.house_id, device.id, ai.status, message],
  );
}

/** The coop's desired settings; marked applied once the coop reports that version. */
async function coopControls(deviceId: string, reportedVersion: number | undefined) {
  let row = await queryOne<{
    config: CoopControls;
    version: number;
    applied_version: number | null;
  }>("select config, version, applied_version from device_controls where device_id = $1", [
    deviceId,
  ]);
  if (!row) {
    row = await queryOne(
      `insert into device_controls (device_id, config, version) values ($1, $2, 1)
       on conflict (device_id) do update set device_id = excluded.device_id
       returning config, version, applied_version`,
      [deviceId, JSON.stringify(DEFAULT_COOP_CONTROLS)],
    );
  }
  if (reportedVersion === row!.version && row!.applied_version !== row!.version) {
    await query(
      "update device_controls set applied_version = $2, applied_at = now() where device_id = $1",
      [deviceId, reportedVersion],
    );
  }
  return { ...row!.config, version: row!.version };
}

async function recordWaterChange(
  device: {
    id: string;
    farm_id: string | null;
    house_id: string | null;
    house_name: string | null;
  },
  deviceCode: string,
  good: boolean,
) {
  if (good) {
    await query(
      "update alerts set resolved = true where device_id = $1 and type = 'water' and not coalesce(resolved, false)",
      [device.id],
    );
    return;
  }
  await raiseOnce(
    device,
    "water",
    "warning",
    `${device.house_name ?? deviceCode}: drinking water is dirty. Change the water.`,
  );
}

/** Insert an alert unless the same one is open or was raised in the last 15 minutes. */
async function raiseOnce(
  device: { id: string; farm_id: string | null; house_id: string | null },
  type: string,
  severity: "warning" | "critical",
  message: string,
) {
  const recent = await queryOne(
    `select 1 from alerts where device_id = $1 and type = $2 and message = $3
        and (not coalesce(resolved, false) or created_at > now() - interval '15 minutes')`,
    [device.id, type, message],
  );
  if (recent) return;
  await query(
    "insert into alerts (farm_id, house_id, device_id, severity, type, message) values ($1,$2,$3,$4,$5,$6)",
    [device.farm_id, device.house_id, device.id, severity, type, message],
  );
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
