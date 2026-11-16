import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { query, queryOne } from "@/lib/db.server";

// ESP32-CAMs running firmware/esp32cam check in here every 60 s (and at once after
// joining Wi-Fi) with their current IP. The site rewrites the camera's stream URL
// to match, so the Cameras page and the vision worker follow a new address from
// the router without anyone editing it.
// Headers: x-device-id, x-api-key   (Cameras -> camera -> "Auto address")
// Body:    { ip, stream_port?, firmware?, rssi? }
// Reply:   { ok, stream_url, next_ms }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

const bodySchema = z.object({
  ip: z.string().regex(ipv4),
  stream_port: z.number().int().min(1).max(65535).default(81),
  firmware: z.string().max(40).optional(),
  rssi: z.number().int().optional(),
});

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/devices/camera")({
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
        if (!device || !timingSafeEqual(device.api_key, apiKey))
          return json({ error: "Unauthorized" }, 401);
        if (device.type !== "camera")
          return json({ error: "This device is not registered as a camera" }, 400);

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid body" }, 400);
        const b = parsed.data;
        const streamUrl = `http://${b.ip}:${b.stream_port}/stream`;

        await query(
          `update devices set last_seen = now(), firmware_version = coalesce($2, firmware_version),
                  last_rssi = coalesce($3, last_rssi) where id = $1`,
          [device.id, b.firmware ?? null, b.rssi ?? null],
        );
        const cam = await queryOne<{ id: string }>(
          `update cameras set stream_url = $2, last_seen = now(), status = 'online'
            where device_id = $1 returning id`,
          [device.id, streamUrl],
        );
        if (!cam) return json({ error: "No camera is linked to this device" }, 404);
        return json({ ok: true, stream_url: streamUrl, next_ms: 60_000 });
      },
    },
  },
});
