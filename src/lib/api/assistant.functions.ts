import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "../db.server";
import { chatCompletion, createRealtimeClientSecret, type ChatMessage } from "../openai.server";
import { requireUser } from "./middleware";
import type { Alert, AiSnapshot } from "./types";
import { AVATAR_ACTIONS, AVATAR_ACTION_IDS, type VoiceSegment } from "../avatar-actions";

// AI assistant tab: live sensor snapshot, text chat, and speech-to-speech.

const SNAPSHOT_SQL = `
  select distinct on (r.device_id) r.*, d.device_id as device_code, d.last_seen, h.name as house_name,
         h.bird_count
    from sensor_readings r
    join devices d on d.id = r.device_id
    left join poultry_houses h on h.id = r.house_id
   order by r.device_id, r.created_at desc`;

type SnapshotRow = AiSnapshot & { bird_count: number | null };

async function loadSnapshot() {
  const [readings, alerts] = await Promise.all([
    query<SnapshotRow>(SNAPSHOT_SQL),
    query<Alert>(
      "select * from alerts where not coalesce(resolved, false) order by created_at desc limit 10",
    ),
  ]);
  return { readings, alerts };
}

export const getAssistantSensors = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(() => loadSnapshot());

// Compact text version of the farm state for the model's system prompt. Only
// fields the Raspberry Pi really sends are included (see edge/agent.py).
function describeFarm(s: Awaited<ReturnType<typeof loadSnapshot>>) {
  const now = Date.now();
  const houses = s.readings.map((r) => ({
    house: r.house_name ?? r.device_code,
    device: r.device_code,
    birds: r.bird_count,
    reading_at: r.created_at,
    reading_age_min: Math.round((now - new Date(r.created_at).getTime()) / 60_000),
    temperature_c: r.temperature,
    target_temp_c: r.target_temp,
    humidity_pct: r.humidity,
    gas_index: r.gas_index,
    light_level: r.light,
    fan_level: r.fan_level,
    fan_duty_pct: r.fan_duty != null ? Math.round(r.fan_duty * 100) : null,
    fan_rpm: r.fan_rpm,
    bird_age_days: r.bird_age_days,
    growth_phase: r.growth_phase,
    ai_status: r.ai_status,
    ai_confidence: r.ai_confidence,
    ai_causes: r.ai_causes?.map((c) => ({ label: c.label, prob: c.prob, advice: c.advice })),
  }));
  const alerts = s.alerts.map((a) => ({
    severity: a.severity,
    message: a.message,
    at: a.created_at,
  }));
  return JSON.stringify({ now: new Date(now).toISOString(), houses, open_alerts: alerts });
}

const HARDWARE = `The farm's hardware is exactly this, nothing more:
- One Raspberry Pi per house running the PoultryGrid edge agent, reporting about every 30 s, with:
  - DHT22: air temperature (°C) and relative humidity (%).
  - MQ-135 gas sensor via an ADS1115 ADC: "gas_index" = % rise in sensor voltage over its clean-air
    baseline. It tracks ammonia and other gases but is not calibrated in ppm, so never quote ppm.
  - LDR light sensor via the ADS1115: "light_level" 0 (dark) to 50 (bright), relative, not lux.
  - Ventilation fan driven by PWM (fan_duty_pct) with a tachometer (fan_rpm). The Pi's model picks
    the fan level (low/medium/high) itself unless a manager forces one in the app.
  - An on-device AI model that gives status (healthy/warning/critical), likely causes with advice,
    the flock's growth phase and the target temperature for the flock's age.
- One ESP32-CAM camera that the farmer can watch live in the Cameras page. You cannot see its images.
There are NO water-level, feed-level, drinker, feeder, lighting-control, power, solar, battery,
biogas, weight or ammonia-ppm sensors. If asked about those, say the farm has no sensor for it and
give practical advice on checking it by hand. Never invent or estimate a reading. If a reading is
null, or reading_age_min is large (over ~5 minutes), say the data is missing or out of date.`;

function systemPrompt(farm: string, voice: boolean) {
  return `You are Ama, the AI assistant inside PoultryGrid, a smart poultry farm dashboard used in Ghana.
You help farmers understand their poultry houses and act on them: temperature, humidity, gas and
ammonia, ventilation, bird health, water, feed and biosecurity. Base answers on the live farm data
below. Give practical, specific advice.

${HARDWARE}

Always reply in the same language the farmer used (English, Twi, Ga, Ewe, Hausa, French, or any other).
If they ask you to translate something, translate it.
${voice ? "This is a live voice conversation and your reply is spoken aloud. Keep it to 1-3 short sentences, no lists, no markdown, no emoji. If the farmer interrupts, stop and listen." : "Keep replies short and easy to read. Plain text, short lists are fine."}

LIVE FARM DATA (JSON, one entry per Pi, latest reading):
${farm}`;
}

const historySchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
  .max(20);

// Text chat ----------------------------------------------------------------

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ messages: historySchema.min(1) }))
  .handler(async ({ data }) => {
    const farm = describeFarm(await loadSnapshot());
    const reply = await chatCompletion([
      { role: "system", content: systemPrompt(farm, false) },
      ...(data.messages as ChatMessage[]),
    ]);
    return { reply: reply.trim() };
  });

// Speech to speech -----------------------------------------------------------
// Voice mode is a live Realtime session: the browser streams the mic to
// OpenAI over WebRTC and plays her voice as it is generated, with server-side
// turn detection and barge-in. This server only mints a short-lived secret
// carrying the instructions and the farm snapshot.

export const createVoiceSession = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async () => {
    const farm = describeFarm(await loadSnapshot());
    return createRealtimeClientSecret(systemPrompt(farm, true));
  });

// Voice gestures + translation ------------------------------------------------
// The live voice call streams Ama's words as text faster than she speaks them.
// As soon as a reply's text is complete, this cheap call splits it into parts,
// picks a body animation for each, and translates both sides to English, so
// her gestures change while she is still talking (no added delay to speech).

const gestureList = AVATAR_ACTION_IDS.filter((id) => id !== "walking" && id !== "idle")
  .map((id) => `- ${id}: ${AVATAR_ACTIONS[id].hint}`)
  .join("\n");

const annotateSchema = {
  name: "voice_annotation",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["language", "you_english", "ama_english", "segments"],
    properties: {
      language: {
        type: "string",
        description: "Language the farmer spoke, named in English, e.g. 'Twi'",
      },
      you_english: { type: "string", description: "Farmer's words in English" },
      ama_english: { type: "string", description: "Ama's reply in English" },
      segments: {
        type: "array",
        description: "Ama's reply split into 1-4 consecutive parts, in its original language",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "action"],
          properties: {
            text: { type: "string" },
            action: {
              type: "string",
              enum: AVATAR_ACTION_IDS.filter((id) => id !== "walking" && id !== "idle"),
            },
          },
        },
      },
    },
  },
};

export const annotateVoiceTurn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ you: z.string().max(4000), ama: z.string().min(1).max(4000) }))
  .handler(async ({ data }) => {
    const raw = await chatCompletion(
      [
        {
          role: "system",
          content: `You annotate one turn of a spoken conversation between a farmer and Ama, a 3D farm assistant.
Split Ama's reply into 1-4 consecutive parts that together are exactly her reply (same words, same order, original language).
Pick a body animation for each part that matches what she says in it:
${gestureList}
Use talking/talking2 most of the time; excited only for greetings or good news; backflip almost never.
Also name the farmer's language and translate both lines to English (repeat them unchanged if already English).`,
        },
        { role: "user", content: `Farmer: ${data.you || "(not transcribed)"}\nAma: ${data.ama}` },
      ],
      { jsonSchema: annotateSchema, maxTokens: 900 },
    );
    const parsed = JSON.parse(raw) as {
      language: string;
      you_english: string;
      ama_english: string;
      segments: VoiceSegment[];
    };
    return { ...parsed, segments: parsed.segments.filter((s) => s.text.trim()) };
  });
