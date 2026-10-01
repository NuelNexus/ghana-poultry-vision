import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { query, queryOne } from "@/lib/db.server";

// Devices (Raspberry Pi edge-AI agent, ESP32 sensor nodes) POST readings here.
// Headers: x-device-id, x-api-key
// Body: a single reading, or { "readings": [...] } for a batch (the Pi sends
// its offline backlog this way). Readings may carry the edge model's output
// under "ai"; status changes become alerts automatically.

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
    fan_level: z.enum(["low", "medium", "high"]).optional(),
    growth_phase: z.string().max(32).optional(),
    target_temp: num,
    model_version: z.string().max(64).optional(),
  })
  .passthrough();

const readingSchema = z
  .object({
    recorded_at: z.string().datetime({ offset: true }).optional(),
    temperature: num,
    humidity: num,
    air_quality: num,
    gas_index: num,
    water_level: num,
    feed_level: num,
    light: num,
    current: num,
    fan_rpm: num,
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
        }>(
          `select d.id, d.api_key, d.house_id, coalesce(d.farm_id, h.farm_id) as farm_id, d.fan_override,
                  h.name as house_name, h.batch_started_at
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
        const now = Date.now();

        for (const r of readings) {
          // Trust the Pi's clock for backlog, but never accept future timestamps.
          const ts =
            r.recorded_at && new Date(r.recorded_at).getTime() <= now + 60_000
              ? r.recorded_at
              : new Date(now).toISOString();
          const ai = r.ai;
          await query(
            `insert into sensor_readings (
               device_id, house_id, temperature, humidity, air_quality, gas_index, water_level, feed_level, light,
               current_a, fan_rpm, fan_duty, bird_age_days, ai_status, ai_confidence, ai_probabilities, ai_causes,
               fan_level, growth_phase, target_temp, model_version, payload, created_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
            [
              device.id,
              device.house_id,
              r.temperature ?? null,
              r.humidity ?? null,
              r.air_quality ?? null,
              r.gas_index ?? null,
              r.water_level ?? null,
              r.feed_level ?? null,
              r.light ?? null,
              r.current ?? null,
              r.fan_rpm ?? null,
              r.fan_duty ?? null,
              r.bird_age_days ?? null,
              ai?.status ?? null,
              ai?.confidence ?? null,
              ai?.probabilities ? JSON.stringify(ai.probabilities) : null,
              ai?.causes ? JSON.stringify(ai.causes) : null,
              ai?.fan_level ?? null,
              ai?.growth_phase ?? null,
              ai?.target_temp ?? null,
              ai?.model_version ?? null,
              JSON.stringify(r),
              ts,
            ],
          );

          if (ai && ai.status !== lastStatus) {
            await recordStatusChange(device, deviceId, lastStatus, ai);
            lastStatus = ai.status;
          }
        }

        await query("update devices set last_seen = now(), online = true where id = $1", [
          device.id,
        ]);

        const age = device.batch_started_at
          ? Math.max(0, Math.floor((now - new Date(device.batch_started_at).getTime()) / 86400_000))
          : null;
        return json({
          ok: true,
          accepted: readings.length,
          config: { bird_age_days: age, fan_override: device.fan_override },
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
  const fan = ai.fan_level ? ` Fan set to ${ai.fan_level}.` : "";
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

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
