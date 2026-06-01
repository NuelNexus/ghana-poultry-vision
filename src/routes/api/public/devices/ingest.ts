import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/devices/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const deviceId = request.headers.get("x-device-id");
        const apiKey = request.headers.get("x-api-key");
        if (!deviceId || !apiKey) {
          return new Response(JSON.stringify({ error: "Missing device credentials" }),
            { status: 401, headers: { "content-type": "application/json" } });
        }
        const { data: device, error: dErr } = await supabaseAdmin
          .from("devices").select("id,api_key,house_id").eq("device_id", deviceId).maybeSingle();
        if (dErr || !device || device.api_key !== apiKey) {
          return new Response(JSON.stringify({ error: "Unauthorized" }),
            { status: 401, headers: { "content-type": "application/json" } });
        }
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const num = (v: unknown) => (typeof v === "number" ? v : v == null ? null : Number(v));
        const { error: insErr } = await supabaseAdmin.from("sensor_readings").insert({
          device_id: device.id,
          house_id: device.house_id,
          temperature: num(body.temperature),
          humidity: num(body.humidity),
          air_quality: num(body.air_quality),
          water_level: num(body.water_level),
          feed_level: num(body.feed_level),
          light: num(body.light),
          current_a: num(body.current),
          payload: body,
        });
        if (insErr) {
          return new Response(JSON.stringify({ error: insErr.message }),
            { status: 500, headers: { "content-type": "application/json" } });
        }
        await supabaseAdmin.from("devices").update({ last_seen: new Date().toISOString(), online: true }).eq("id", device.id);
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      },
      OPTIONS: async () => new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type, x-device-id, x-api-key",
        },
      }),
    },
  },
});
