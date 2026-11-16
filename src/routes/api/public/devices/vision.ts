import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { query, queryOne } from "@/lib/db.server";

// The camera vision worker (edge/vision.py, YOLO11n) talks to the site here. It
// runs on the Pi or on any PC on the farm network, and signs in with a registered
// device's credentials (Devices page): headers x-device-id, x-api-key.
//
// GET   -> { cameras: [{ id, name, stream_url, rotation, device_code }] }   the cameras of
//          that device's farm (device_code: the camera's own device ID, when it runs
//          firmware/esp32cam; the PC relay uses this to match a pushing camera)
// POST  -> one analysis of one camera:
//   { camera_id, birds, inactive, activity, pests: [{label, confidence}],
//     events: [{kind, label, detail}], frame_jpeg_b64?, worker? }
//   Saved as the camera's latest analysis (with a small annotated frame), and each
//   event as a vision event. A pest or inactive birds also open an alert.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function authDevice(request: Request) {
  const deviceId = request.headers.get("x-device-id");
  const apiKey = request.headers.get("x-api-key");
  if (!deviceId || !apiKey) return null;
  const d = await queryOne<{
    id: string;
    api_key: string;
    owner_id: string | null;
    farm_id: string | null;
  }>("select id, api_key, owner_id, farm_id from devices where device_id = $1", [deviceId]);
  return d && d.owner_id && timingSafeEqual(d.api_key, apiKey) ? d : null;
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const bodySchema = z.object({
  camera_id: z.string().uuid(),
  birds: z.number().int().min(0).max(10_000),
  inactive: z.number().int().min(0).max(10_000),
  activity: z.number().min(0).max(1).nullable(),
  pests: z
    .array(z.object({ label: z.string().max(40), confidence: z.number().min(0).max(1) }))
    .max(50),
  events: z
    .array(
      z.object({
        kind: z.enum(["pest", "inactive", "low_activity"]),
        label: z.string().max(60),
        detail: z.string().max(300).optional(),
      }),
    )
    .max(20)
    .default([]),
  // A small annotated JPEG (the worker keeps it under ~120 KB).
  frame_jpeg_b64: z.string().max(200_000).optional(),
  worker: z.string().max(60).optional(),
});

export const Route = createFileRoute("/api/public/devices/vision")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const device = await authDevice(request);
        if (!device) return json({ error: "Unauthorized" }, 401);
        const cameras = await query<{
          id: string;
          name: string;
          stream_url: string | null;
          rotation: number;
          device_code: string | null;
        }>(
          `select c.id, c.name, c.stream_url, c.rotation, d.device_id as device_code
             from cameras c left join devices d on d.id = c.device_id
            where c.owner_id = $1 order by c.created_at`,
          [device.owner_id],
        );
        return json({ cameras });
      },
      POST: async ({ request }) => {
        const device = await authDevice(request);
        if (!device) return json({ error: "Unauthorized" }, 401);
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid body" }, 400);
        const b = parsed.data;

        const cam = await queryOne<{ id: string; name: string; house_id: string | null }>(
          "select id, name, house_id from cameras where id = $1 and owner_id = $2",
          [b.camera_id, device.owner_id],
        );
        if (!cam) return json({ error: "Camera not found" }, 404);

        const frame = b.frame_jpeg_b64 ? Buffer.from(b.frame_jpeg_b64, "base64") : null;
        await query(
          `insert into camera_vision (camera_id, analysed_at, birds, inactive, activity, pests, frame, worker)
           values ($1, now(), $2, $3, $4, $5, $6, $7)
           on conflict (camera_id) do update set analysed_at = now(), birds = excluded.birds,
             inactive = excluded.inactive, activity = excluded.activity, pests = excluded.pests,
             frame = coalesce(excluded.frame, camera_vision.frame), worker = excluded.worker`,
          [
            cam.id,
            b.birds,
            b.inactive,
            b.activity,
            JSON.stringify(b.pests),
            frame,
            b.worker ?? null,
          ],
        );

        for (const e of b.events) {
          // The worker already rate-limits; this stops a burst of repeats all the same.
          const recent = await queryOne(
            `select 1 from vision_events where camera_id = $1 and kind = $2 and label = $3
               and created_at > now() - interval '10 minutes'`,
            [cam.id, e.kind, e.label],
          );
          if (recent) continue;
          await query(
            "insert into vision_events (camera_id, kind, label, detail) values ($1, $2, $3, $4)",
            [cam.id, e.kind, e.label, e.detail ?? null],
          );
          await openAlert(device, cam, e).catch(() => {
            /* the event is saved even if the alert can't be */
          });
        }
        return json({ ok: true });
      },
    },
  },
});

/** A pest or birds that stopped moving show up on the Alerts page too. */
async function openAlert(
  device: { id: string; farm_id: string | null },
  cam: { id: string; name: string; house_id: string | null },
  e: { kind: string; label: string; detail?: string },
) {
  const what =
    e.kind === "pest"
      ? `${cap(e.label)} seen`
      : e.kind === "inactive"
        ? "Inactive birds"
        : "Low flock activity";
  const message = `${cam.name}: ${what}. ${e.detail ?? ""}`.trim();
  // One open alert per camera and kind; it is reused while unresolved.
  const open = await queryOne(
    `select 1 from alerts where device_id = $1 and type = 'camera' and message like $2
        and not coalesce(resolved, false)`,
    [device.id, `${cam.name}: ${what}%`],
  );
  if (open) return;
  const house = cam.house_id
    ? await queryOne<{ farm_id: string }>("select farm_id from poultry_houses where id = $1", [
        cam.house_id,
      ])
    : null;
  await query(
    `insert into alerts (farm_id, house_id, device_id, severity, type, message)
     values ($1, $2, $3, $4, 'camera', $5)`,
    [
      house?.farm_id ?? device.farm_id,
      cam.house_id,
      device.id,
      e.kind === "pest" ? "critical" : "warning",
      message,
    ],
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
