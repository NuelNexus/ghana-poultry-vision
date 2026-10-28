import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query, queryOne } from "../db.server";
import {
  chatCompletion,
  createRealtimeClientSecret,
  fromBase64,
  localModel,
  transcribe,
  type ChatMessage,
  openAiFirst,
} from "../openai.server";
import { KHAYA_CODES, detectLang, langName, type SpeechLang } from "../ai-languages";
import { khayaEnabled, khayaTranscribe, khayaTranslate } from "../khaya.server";
import { twiVoiceOnline, wakeTwiVoice } from "../twi-tts.server";
import { speakIn } from "../voice.server";
import { SITE_LANG_IDS, siteLang, speechLangFor, type SiteLang } from "../site-lang";
import { twiSuggest, twiWordsEnabled } from "../twi-nlp.server";
import { requireUser } from "./middleware";
import type { Alert, AiSnapshot } from "./types";
import type { CoopZoneState } from "../controls";
import { AVATAR_ACTIONS, AVATAR_ACTION_IDS, type VoiceSegment } from "../avatar-actions";

// AI assistant tab: live sensor snapshot, text chat, and speech-to-speech.

// Only the signed-in account's devices and alerts ($1 = user id). Most recently
// reporting first, so the readings rail opens on the live device rather than a
// long-silent one.
const SNAPSHOT_SQL = `
  select * from (
    select distinct on (r.device_id) r.*, d.device_id as device_code, d.last_seen, h.name as house_name,
           h.bird_count, d.unit
      from sensor_readings r
      join devices d on d.id = r.device_id
      left join poultry_houses h on h.id = r.house_id
     where d.owner_id = $1
     order by r.device_id, r.created_at desc
  ) latest
  order by created_at desc`;

type SnapshotRow = AiSnapshot & {
  bird_count: number | null;
  unit: "brooder" | "coop" | null;
  /** Coop unit only (firmware/coop_unit). */
  zones?: Record<string, CoopZoneState> | null;
  water_ok?: boolean | null;
};

async function loadSnapshot(userId: string) {
  const [readings, alerts] = await Promise.all([
    query<SnapshotRow>(SNAPSHOT_SQL, [userId]),
    query<Alert>(
      `select * from alerts
        where not coalesce(resolved, false)
          and (farm_id in (select id from farms where owner_id = $1)
               or device_id in (select id from devices where owner_id = $1))
        order by created_at desc limit 10`,
      [userId],
    ),
  ]);
  return { readings, alerts };
}

/** The live farm state as compact JSON, for prompts elsewhere (voice commands). */
export async function farmSummary(userId: string) {
  return describeFarm(await loadSnapshot(userId));
}

export const getAssistantSensors = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(({ context }) => loadSnapshot(context.user.id));

// Compact text version of the farm state for the model's system prompt. Only
// fields the units really send are included (edge/agent.py, firmware/coop_unit).
function describeFarm(s: Awaited<ReturnType<typeof loadSnapshot>>) {
  const now = Date.now();
  const houses = s.readings.map((r) => ({
    house: r.house_name ?? r.device_code,
    device: r.device_code,
    unit: r.unit === "coop" ? "coop unit (ESP32)" : "incubator & brooder (Raspberry Pi)",
    ...(r.unit === "coop"
      ? {
          zones: r.zones,
          drinking_water: r.water_ok == null ? null : r.water_ok ? "clean" : "dirty",
        }
      : {}),
    birds: r.bird_count,
    reading_at: r.created_at,
    reading_age_min: Math.round((now - new Date(r.created_at).getTime()) / 60_000),
    temperature_c: r.temperature,
    target_temp_c: r.target_temp,
    humidity_pct: r.humidity,
    gas_index: r.gas_index,
    light_level: r.light,
    fan_on: r.fan_on,
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
  - MQ-135 gas sensor: "gas_index" = % rise in sensor voltage over its clean-air baseline. It tracks
    ammonia and other gases but is not calibrated in ppm, so never quote ppm.
  - LDR light sensor: "light_level" 0 (dark) to 50 (bright), relative, not lux.
  - One ventilation fan switched by a relay, so it is only on or off (fan_on). There is no speed
    control and no speed sensor, so never talk about fan speed or rpm. The Pi's model switches it
    itself unless a manager forces it on or off in the app.
  - An on-device AI model that gives status (healthy/warning/critical), likely causes with advice,
    the flock's growth phase and the target temperature for the flock's age.
- Optionally a coop unit (unit 2): an ESP32 reporting about every 10 s, with two zones, "layers"
  and "broilers". Each zone has a temperature sensor (DHT22 / DHT11, also humidity), a fan relay
  and a heat lamp relay (each only on or off). A zone is either on Auto (the coop's own thermostat:
  fan on above one temperature, lamp on below another) or Manual (the farmer switches fan and lamp
  on the Automation page). The lamp is cut off automatically if a zone overheats or its sensor
  fails ("safety_tripped"). A turbidity sensor in the drinker says whether the drinking water is
  clean or dirty; it does not measure the water level. Its readings appear as "zones" and
  "drinking_water" below.
- One ESP32-CAM camera that the farmer can watch live in the Cameras page. You cannot see its images.
The app also has a Marketplace where farmers sell eggs, birds, chicks, manure, feed and equipment
to each other and message buyers; you can't see listings, but you can explain how to use it.
There are NO water-level, feed-level, feeder, power, solar, battery,
biogas, weight or ammonia-ppm sensors. If asked about those, say the farm has no sensor for it and
give practical advice on checking it by hand. Never invent or estimate a reading. When you do talk
about a reading and it is null, or reading_age_min is large (over ~5 minutes), say the data is
missing or out of date.`;

function systemPrompt(
  farm: string,
  voice: boolean,
  lang: SpeechLang = "auto",
  uiLang: SiteLang = "en",
) {
  const langLine =
    lang !== "auto"
      ? `\nThe farmer has said they will speak ${langName(lang)}. Expect ${langName(lang)} and reply in ${langName(lang)} unless they clearly switch language.`
      : uiLang !== "en"
        ? `\nThe farmer uses the app in ${siteLang(uiLang).name}. If you can't tell which language they used, reply in ${siteLang(uiLang).name}.`
        : "";
  return `You are Ama, the AI assistant inside PoultryGrid, a smart poultry farm dashboard used in Ghana.
You help farmers understand their poultry houses and act on them: temperature, humidity, gas and
ammonia, ventilation, bird health, water, feed and biosecurity. Give practical, specific advice.

WHEN TO MENTION READINGS: answer what the farmer actually asked. Only bring up the live farm data
below (temperature, humidity, gas, fan, how old the data is) when they ask about those readings,
about how the farm or a house is doing, or when there is an open critical alert they should know
about. For greetings, small talk and general questions (feed, vaccines, eggs, diseases, prices),
just answer that, in any language, without adding readings or status updates.

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
 * One reply from Ama. For Twi, Ewe, Hausa (and Ga with Khaya) she thinks in
 * English and a translator trained on that language works both ways: the
 * farmer's words into English for her, and her plain-English answer into their
 * language (Khaya).
 * That reads far more naturally than a general model writing Twi itself.
 * Everything else is answered directly.
 */
const canTranslate = (lang: SpeechLang) => khayaEnabled() && Boolean(KHAYA_CODES[lang]?.mt);

async function translate(text: string, from: SpeechLang, to: SpeechLang) {
  const lang = from === "en" ? to : from;
  if (khayaEnabled() && KHAYA_CODES[lang]?.mt) return khayaTranslate(text, from, to);
  return null;
}
/** Twi, Ga, Ewe, Dagbani, Hausa: the bigger model, the only one that writes them well. */
const LOCAL_UI: SiteLang[] = ["tw", "ga", "ee", "dag", "ha"];
const modelFor = (lang: SpeechLang, uiLang: SiteLang) =>
  (lang !== "auto" && lang !== "en" && lang !== "fr") || LOCAL_UI.includes(uiLang)
    ? localModel()
    : undefined;

async function answer(
  farm: string,
  turns: Turn[],
  lang: SpeechLang,
  voice: boolean,
  uiLang: SiteLang = "en",
) {
  const direct = async () => ({
    reply: stripBold(
      await chatCompletion(
        [
          { role: "system", content: systemPrompt(farm, voice, lang, uiLang) },
          ...turns.map((t) => ({ role: t.role, content: t.content })),
        ],
        { model: modelFor(lang, uiLang) },
      ),
    ).trim(),
    english: null as string | null,
    youEnglish: null as string | null,
  });
  if (!canTranslate(lang)) return direct();

  const name = langName(lang);
  const last = turns[turns.length - 1];
  const youEnglish =
    last?.role === "user"
      ? (last.english ?? (await translate(last.content, lang, "en").catch(() => null)))
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
    const reply = await translate(english, "en", lang);
    if (reply) return { reply, english, youEnglish };
  } catch {
    /* translators down: let the model write the language itself */
  }
  return { ...(await direct()), youEnglish };
}

/** Speech to text, with Khaya for the Ghanaian languages and OpenAI otherwise. */
/**
 * Speech to text in whatever language was spoken. OpenAI's transcriber writes it
 * down first; if that turns out to be Twi and there is a Khaya key, Khaya (trained
 * on Ghanaian speech) transcribes it again.
 */
export async function hear(audio: Uint8Array, mimeType: string, uiLang: SiteLang = "en") {
  // The site language steers the transcriber toward that language's spelling;
  // English and French speakers get the open "auto" hint.
  const hint = uiLang === "en" || uiLang === "fr" ? "auto" : siteLang(uiLang).speech;
  const text = await transcribe(audio, mimeType, hint);
  if (khayaEnabled() && mimeType.includes("wav") && detectLang(text) === "tw") {
    try {
      const better = await khayaTranscribe(audio, "tw");
      if (better) return better;
    } catch {
      /* keep OpenAI's */
    }
  }
  return text;
}

/** Which speech engines this server has keys for (the browser picks its voice mode from it). */
export const getSpeechEngines = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async () => {
    const twiVoice = await twiVoiceOnline();
    return {
      khaya: khayaEnabled(),
      twiVoice,
      twiWords: twiWordsEnabled(),
      /** The live voice call is OpenAI only; without a key, the chat mic does voice instead. */
      liveVoice: openAiFirst(),
    };
  });

/** Twi word suggestions from DistilABENA: the next word, or the word for a "___" blank. */
export const suggestTwiWords = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ text: z.string().max(2000) }))
  .handler(({ data }) => twiSuggest(data.text, 10));

/** Called while the AI tab is open in Twi, so the Pi polls fast and replies aren't delayed. */
export const wakeTwiVoiceFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async () => {
    await wakeTwiVoice();
    return { ok: true };
  });

// Chat history ---------------------------------------------------------------
// Every conversation (text and voice) is saved per user, so they can come back to it.

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
      uiLang: z.enum(SITE_LANG_IDS).default("en"),
    }),
  )
  .handler(async ({ data, context }) => {
    const last = data.messages[data.messages.length - 1];
    // Twi -> the Ghanaian stack; anything else -> GPT, answering in the farmer's language.
    const lang = detectLang(last.content);
    const [farm, conversationId] = await Promise.all([
      loadSnapshot(context.user.id).then(describeFarm),
      conversationFor(context.user.id, data.conversationId, last.content),
    ]);
    const { reply, english, youEnglish } = await answer(
      farm,
      data.messages,
      lang,
      false,
      data.uiLang,
    );
    const language = lang !== "auto" ? langName(lang) : null;
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
      uiLang: z.enum(SITE_LANG_IDS).default("en"),
    }),
  )
  .handler(async ({ data }) => ({
    text: await hear(fromBase64(data.audio), data.mimeType, data.uiLang),
  }));

// Speech for one sentence of a reply (the browser sends them one by one and plays
// each as it arrives): audio as base64.
export const speakReply = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(
    z.object({
      text: z.string().min(1).max(4000),
      /** Language of the whole reply, so every sentence uses the same voice. */
      lang: z.enum(["auto", "en", "tw", "ga", "ee", "dag", "ha", "fr"]).optional(),
      uiLang: z.enum(SITE_LANG_IDS).default("en"),
      slowTwi: z.boolean().default(false),
    }),
  )
  .handler(({ data }) =>
    speakIn(data.text, data.lang ?? speechLangFor(data.text, data.uiLang), {
      slowTwi: data.slowTwi,
    }),
  );

// A Twi turn inside the live voice call. The call is OpenAI's realtime model;
// when the farmer's words come back as Twi, the browser holds its reply and asks
// here instead: Ama answers through the Twi stack and the GhanaNLP voice speaks.
export const twiReply = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ text: z.string().min(1).max(4000), history: historySchema.max(12) }))
  .handler(async ({ data, context }) => {
    const farm = describeFarm(await loadSnapshot(context.user.id));
    const turn = await answer(
      farm,
      [...data.history, { role: "user", content: data.text }],
      "tw",
      true,
    );
    // Text only: the browser speaks it sentence by sentence (speakReply), so her
    // words show at once and the first sentence plays while the rest is made.
    return { ama: turn.reply, amaEnglish: turn.english, youEnglish: turn.youEnglish };
  });

// Speech to speech -----------------------------------------------------------
// Voice mode is a live Realtime session: the browser streams the mic to
// OpenAI over WebRTC and plays her voice as it is generated, with server-side
// turn detection and barge-in. This server only mints a short-lived secret
// carrying the instructions and the farm snapshot.

export const createVoiceSession = createServerFn({ method: "POST" })
  .middleware([requireUser])
  // twiRouting: the browser decides who answers each turn (Twi -> twiReply), so the
  // realtime model waits to be asked instead of answering on its own.
  .inputValidator(
    z.object({
      twiRouting: z.boolean().default(false),
      uiLang: z.enum(SITE_LANG_IDS).default("en"),
    }),
  )
  .handler(async ({ data, context }) => {
    const farm = describeFarm(await loadSnapshot(context.user.id));
    // The site language steers speech recognition toward that language's spelling.
    const hint =
      data.uiLang === "en" || data.uiLang === "fr" ? "auto" : siteLang(data.uiLang).speech;
    return createRealtimeClientSecret(systemPrompt(farm, true, "auto", data.uiLang), hint, {
      manualResponse: data.twiRouting,
    });
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
