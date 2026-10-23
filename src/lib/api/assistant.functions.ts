import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query, queryOne } from "../db.server";
import {
  chatCompletion,
  createRealtimeClientSecret,
  fromBase64,
  speak,
  toBase64,
  transcribe,
  type ChatMessage,
} from "../openai.server";
import { KHAYA_CODES, isSpeechLang, langName, usesKhaya, type SpeechLang } from "../ai-languages";
import { khayaEnabled, khayaSpeak, khayaTranscribe, khayaTranslate } from "../khaya.server";
import { twiSpeak, twiVoiceOnline, wakeTwiVoice } from "../twi-tts.server";
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

function systemPrompt(farm: string, voice: boolean, lang: SpeechLang = "auto") {
  const langLine =
    lang === "auto"
      ? ""
      : `\nThe farmer has said they will speak ${langName(lang)}. Expect ${langName(lang)} and reply in ${langName(lang)} unless they clearly switch language.`;
  return `You are Ama, the AI assistant inside PoultryGrid, a smart poultry farm dashboard used in Ghana.
You help farmers understand their poultry houses and act on them: temperature, humidity, gas and
ammonia, ventilation, bird health, water, feed and biosecurity. Base answers on the live farm data
below. Give practical, specific advice.

${HARDWARE}

Always reply in the same language the farmer used (English, Twi, Ga, Ewe, Hausa, French, or any other).${langLine}
If they ask you to translate something, translate it.
${voice ? "This is a live voice conversation and your reply is spoken aloud. Keep it to 1-3 short sentences, no lists, no markdown, no emoji. If the farmer interrupts, stop and listen." : "Keep replies short and easy to read. Plain text, short lists are fine."}

LIVE FARM DATA (JSON, one entry per Pi, latest reading):
${farm}`;
}

const historySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(4000),
      english: z.string().max(4000).nullish(),
    }),
  )
  .max(20);
type Turn = z.infer<typeof historySchema>[number];

const stripBold = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "$1");

/**
 * One reply from Ama. For Twi, Ga and Ewe (with a Khaya key) she thinks in
 * English and GhanaNLP's Khaya translates both ways: the farmer's words into
 * English for her, and her plain-English answer into their language. Khaya is
 * trained on Ghanaian text, so the result reads far more naturally than GPT
 * writing Twi itself. Everything else is answered directly by GPT.
 */
async function answer(farm: string, turns: Turn[], lang: SpeechLang, voice: boolean) {
  const direct = async () => ({
    reply: (
      await chatCompletion([
        { role: "system", content: systemPrompt(farm, voice, lang) },
        ...turns.map((t) => ({ role: t.role, content: t.content })),
      ])
    ).trim(),
    english: null as string | null,
    youEnglish: null as string | null,
  });
  if (!khayaEnabled() || !KHAYA_CODES[lang]?.mt) return direct();

  const name = langName(lang);
  const last = turns[turns.length - 1];
  const youEnglish =
    last?.role === "user"
      ? (last.english ?? (await khayaTranslate(last.content, lang, "en").catch(() => null)))
      : null;
  const msgs: ChatMessage[] = turns.map((t, i) => {
    if (t.role === "assistant") return { role: "assistant", content: t.english || t.content };
    const en = i === turns.length - 1 ? youEnglish : t.english;
    return {
      role: "user",
      content:
        en && en !== t.content
          ? `${t.content}\n\n(Machine translation to English: ${en})`
          : t.content,
    };
  });
  const english = stripBold(
    (
      await chatCompletion([
        {
          role: "system",
          content: `${systemPrompt(farm, voice, "en")}

LANGUAGE: The farmer speaks ${name}. Their messages may come with a machine translation into
English; use it with the original to understand them (the translation can be rough). Always write
your reply in short, simple, plain English sentences, with no idioms, slang or bold text, even if
they wrote in ${name}: a translation model turns your English into ${name} for them.`,
        },
        ...msgs,
      ])
    ).trim(),
  );
  try {
    const reply = await khayaTranslate(english, "en", lang);
    if (reply) return { reply, english, youEnglish };
  } catch {
    /* Khaya is down: let GPT write the language itself */
  }
  return { ...(await direct()), youEnglish };
}

/** Speech to text, with Khaya for the Ghanaian languages and OpenAI otherwise. */
async function hear(audio: Uint8Array, mimeType: string, lang: SpeechLang) {
  if (khayaEnabled() && usesKhaya(lang) && mimeType.includes("wav")) {
    try {
      const text = await khayaTranscribe(audio, lang);
      if (text) return text;
    } catch {
      /* fall back to OpenAI */
    }
  }
  return transcribe(audio, mimeType, lang);
}

/**
 * Ama's voice. Twi: the farm Pi's stable-twi-tts voice first, then Khaya, then
 * OpenAI. Ga, Ewe, Hausa: Khaya, then OpenAI. Everything else: OpenAI.
 */
async function voiceFor(text: string, lang: SpeechLang) {
  const clean = stripBold(text).replace(/^\s*[-*•]\s+/gm, "");
  if (lang === "tw") {
    try {
      return { audio: toBase64(await twiSpeak(clean)), mimeType: "audio/wav" };
    } catch {
      /* Pi offline or slow: next option */
    }
  }
  if (khayaEnabled() && usesKhaya(lang)) {
    try {
      return { audio: toBase64(await khayaSpeak(clean, lang)), mimeType: "audio/wav" };
    } catch {
      /* fall back to OpenAI */
    }
  }
  const mp3 = await speak(clean, lang === "auto" ? undefined : langName(lang));
  return { audio: toBase64(mp3), mimeType: "audio/mpeg" };
}

/** Which speech engines this server has keys for (the browser picks its voice mode from it). */
export const getSpeechEngines = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async () => ({ khaya: khayaEnabled(), twiVoice: await twiVoiceOnline() }));

/** Called while the AI tab is open in Twi, so the Pi polls fast and replies aren't delayed. */
export const wakeTwiVoiceFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async () => {
    await wakeTwiVoice();
    return { ok: true };
  });

// Chat history ---------------------------------------------------------------
// Every conversation (text and voice) is saved per user, so they can come back to it.

const langSchema = z
  .string()
  .optional()
  .transform((v): SpeechLang => (isSpeechLang(v) ? v : "auto"));

type ConversationRow = { id: string; title: string; created_at: string; updated_at: string };
export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: "text" | "voice";
  language: string | null;
  english: string | null;
  created_at: string;
};
type NewMessage = Pick<StoredMessage, "role" | "content" | "mode"> &
  Partial<Pick<StoredMessage, "language" | "english">>;

async function ownConversation(userId: string, id: string) {
  const row = await queryOne<{ id: string }>(
    "select id from ai_conversations where id = $1 and user_id = $2",
    [id, userId],
  );
  if (!row) throw new Error("Conversation not found");
  return row.id;
}

/** Use the given conversation, or start one titled after the first message. */
async function conversationFor(userId: string, id: string | undefined, firstText: string) {
  if (id) return ownConversation(userId, id);
  const title = firstText.replace(/\s+/g, " ").trim().slice(0, 80) || "New chat";
  const row = await queryOne<{ id: string }>(
    "insert into ai_conversations (user_id, title) values ($1, $2) returning id",
    [userId, title],
  );
  return row!.id;
}

async function saveMessages(conversationId: string, rows: NewMessage[]) {
  for (const r of rows) {
    await query(
      `insert into ai_messages (conversation_id, role, content, mode, language, english)
       values ($1, $2, $3, $4, $5, $6)`,
      [conversationId, r.role, r.content, r.mode, r.language ?? null, r.english ?? null],
    );
  }
  await query("update ai_conversations set updated_at = now() where id = $1", [conversationId]);
}

export type ConversationSummary = ConversationRow & { message_count: number; has_voice: boolean };

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(({ context }) =>
    query<ConversationSummary>(
      `select c.id, c.title, c.created_at, c.updated_at,
              (select count(*) from ai_messages m where m.conversation_id = c.id)::int as message_count,
              exists (select 1 from ai_messages m
                       where m.conversation_id = c.id and m.mode = 'voice') as has_voice
         from ai_conversations c
        where c.user_id = $1
        order by c.updated_at desc
        limit 100`,
      [context.user.id],
    ),
  );

export const getConversation = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await ownConversation(context.user.id, data.id);
    const [conversation, messages] = await Promise.all([
      queryOne<ConversationRow>(
        "select id, title, created_at, updated_at from ai_conversations where id = $1",
        [data.id],
      ),
      query<StoredMessage>(
        `select id, role, content, mode, language, english, created_at
           from ai_messages where conversation_id = $1 order by created_at, id`,
        [data.id],
      ),
    ]);
    return { conversation: conversation!, messages };
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await query("delete from ai_conversations where id = $1 and user_id = $2", [
      data.id,
      context.user.id,
    ]);
    return { ok: true };
  });

// Text chat ----------------------------------------------------------------

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(
    z.object({
      messages: historySchema.min(1),
      conversationId: z.string().uuid().optional(),
      lang: langSchema,
    }),
  )
  .handler(async ({ data, context }) => {
    const last = data.messages[data.messages.length - 1];
    const [farm, conversationId] = await Promise.all([
      loadSnapshot().then(describeFarm),
      conversationFor(context.user.id, data.conversationId, last.content),
    ]);
    const { reply, english, youEnglish } = await answer(farm, data.messages, data.lang, false);
    const language = english || youEnglish ? langName(data.lang) : null;
    await saveMessages(conversationId, [
      ...(last.role === "user"
        ? [
            {
              role: "user" as const,
              content: last.content,
              mode: "text" as const,
              language,
              english: youEnglish && youEnglish !== last.content ? youEnglish : null,
            },
          ]
        : []),
      { role: "assistant", content: reply, mode: "text", language, english },
    ]);
    return { reply, english, youEnglish, conversationId };
  });

// Dictation for the text chat: a short recording from the browser -> text.
export const transcribeSpeech = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(
    z.object({
      audio: z.string().min(1).max(8_000_000), // base64, about 6 MB (a few minutes of speech)
      mimeType: z.string().max(100),
      lang: langSchema,
    }),
  )
  .handler(async ({ data }) => ({
    text: await hear(fromBase64(data.audio), data.mimeType, data.lang),
  }));

// Spoken replies for the text chat ("Voice replies" on): audio as base64.
export const speakReply = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ text: z.string().min(1).max(4000), lang: langSchema }))
  .handler(({ data }) => voiceFor(data.text, data.lang));

// Voice mode in Twi, Ga, Ewe and Hausa (with a Khaya key). OpenAI's live voice
// can't use Khaya, so these calls go turn by turn: the browser sends what the
// farmer said once they pause, and gets back her words and her voice.
export const voiceTurn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(
    z.object({
      audio: z.string().min(1).max(8_000_000), // base64 16 kHz WAV
      lang: langSchema,
      conversationId: z.string().uuid().optional(),
      history: historySchema.max(12),
    }),
  )
  .handler(async ({ data, context }) => {
    const [you, farm] = await Promise.all([
      hear(fromBase64(data.audio), "audio/wav", data.lang),
      loadSnapshot().then(describeFarm),
    ]);
    if (!you.trim()) return { you: "" };
    const turn = await answer(
      farm,
      [...data.history, { role: "user", content: you }],
      data.lang,
      true,
    );
    const [voice, conversationId] = await Promise.all([
      voiceFor(turn.reply, data.lang),
      conversationFor(context.user.id, data.conversationId, `Voice: ${you}`),
    ]);
    const language = langName(data.lang);
    await saveMessages(conversationId, [
      {
        role: "user",
        content: you,
        mode: "voice",
        language,
        english: turn.youEnglish && turn.youEnglish !== you ? turn.youEnglish : null,
      },
      { role: "assistant", content: turn.reply, mode: "voice", language, english: turn.english },
    ]);
    return {
      you,
      youEnglish: turn.youEnglish,
      ama: turn.reply,
      amaEnglish: turn.english,
      ...voice,
      conversationId,
    };
  });

// Speech to speech -----------------------------------------------------------
// Voice mode is a live Realtime session: the browser streams the mic to
// OpenAI over WebRTC and plays her voice as it is generated, with server-side
// turn detection and barge-in. This server only mints a short-lived secret
// carrying the instructions and the farm snapshot.

export const createVoiceSession = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ lang: langSchema }))
  .handler(async ({ data }) => {
    const farm = describeFarm(await loadSnapshot());
    return createRealtimeClientSecret(systemPrompt(farm, true, data.lang), data.lang);
  });

// Each finished voice turn is saved into that call's conversation, with English
// translations when the farmer spoke another language.
export const saveVoiceTurn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(
    z.object({
      conversationId: z.string().uuid().optional(),
      you: z.string().max(4000),
      ama: z.string().min(1).max(4000),
      language: z.string().max(40).optional(),
      youEnglish: z.string().max(4000).optional(),
      amaEnglish: z.string().max(4000).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const you = data.you.trim();
    const id = await conversationFor(
      context.user.id,
      data.conversationId,
      `Voice: ${you || data.ama}`,
    );
    const language = data.language ?? null;
    const english = (en: string | undefined, orig: string) =>
      en && en.trim() && en.trim() !== orig.trim() ? en.trim() : null;
    await saveMessages(id, [
      ...(you
        ? [
            {
              role: "user" as const,
              content: you,
              mode: "voice" as const,
              language,
              english: english(data.youEnglish, you),
            },
          ]
        : []),
      {
        role: "assistant",
        content: data.ama.trim(),
        mode: "voice",
        language,
        english: english(data.amaEnglish, data.ama),
      },
    ]);
    return { conversationId: id };
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
