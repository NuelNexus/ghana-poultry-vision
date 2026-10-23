import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { queryOne } from "@/lib/db.server";

// The Pi's Twi voice service (edge/twi_tts.py) talks to the site here, with the
// same x-device-id / x-api-key headers as /ingest.
//   GET  ?wait=1          claim the next queued reply (held open up to ~15 s when
//                         someone is talking to Ama), returns { job, hot }
//   POST ?job=<id>        upload the result: { audio: base64 WAV } or { error }
// "hot" tells the Pi to poll every second instead of every 20 s.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function authDevice(request: Request) {
  const deviceId = request.headers.get("x-device-id");
  const apiKey = request.headers.get("x-api-key");
  if (!deviceId || !apiKey) return null;
  const d = await queryOne<{ id: string; api_key: string }>(
    "select id, api_key from devices where device_id = $1",
    [deviceId],
  );
  return d && timingSafeEqual(d.api_key, apiKey) ? d.id : null;
}

type Job = { id: string; text: string; voice: string };

const claim = (deviceId: string) =>
  queryOne<Job>(
    `update tts_jobs set status = 'working', device_id = $1, updated_at = now()
      where id = (select id from tts_jobs
                   where status = 'queued' and created_at > now() - interval '1 minute'
                   order by created_at limit 1 for update skip locked)
      returning id, text, voice`,
    [deviceId],
  );

const resultSchema = z.union([
  z.object({ audio: z.string().min(1).max(12_000_000) }),
  z.object({ error: z.string().max(500) }),
]);

export const Route = createFileRoute("/api/public/devices/tts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const device = await authDevice(request);
        if (!device) return json({ error: "Unauthorized" }, 401);
        const state = await queryOne<{ hot: boolean }>(
          `update devices set tts_seen_at = now() where id = $1
           returning coalesce(tts_wanted_until > now(), false) as hot`,
          [device],
        );
        const hot = Boolean(state?.hot);
        const wait = hot && new URL(request.url).searchParams.get("wait") === "1";
        const until = Date.now() + (wait ? 15_000 : 0);
        do {
          const job = await claim(device);
          if (job) return json({ job, hot: true });
          if (Date.now() >= until) break;
          await sleep(400);
        } while (!request.signal.aborted);
        return json({ job: null, hot });
      },
      POST: async ({ request }) => {
        const device = await authDevice(request);
        if (!device) return json({ error: "Unauthorized" }, 401);
        const id = new URL(request.url).searchParams.get("job") ?? "";
        if (!z.string().uuid().safeParse(id).success) return json({ error: "Bad job id" }, 400);
        const body = resultSchema.safeParse(await request.json().catch(() => null));
        if (!body.success) return json({ error: "Send { audio } or { error }" }, 400);
        const done = "audio" in body.data;
        const row = await queryOne<{ id: string }>(
          `update tts_jobs set status = $3, audio = $4, error = $5, updated_at = now()
            where id = $1 and device_id = $2 and status = 'working' returning id`,
          [
            id,
            device,
            done ? "done" : "error",
            done ? (body.data as { audio: string }).audio : null,
            done ? null : (body.data as { error: string }).error,
          ],
        );
        if (!row) return json({ error: "No such job for this device" }, 404);
        return json({ ok: true });
      },
    },
  },
});

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
