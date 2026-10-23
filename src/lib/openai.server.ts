import process from "node:process";
import { STT_ISO, STT_PROMPT, isPromptEcho, type SpeechLang } from "./ai-languages";

// Thin OpenAI REST client for the AI assistant tab. Server-only: the key in
// OPENAI_API_KEY never reaches the browser.
//
// Models are the low-cost tier by default and can be swapped via .env:
//   OPENAI_CHAT_MODEL  - answers + translation   (default gpt-4o-mini)
//   OPENAI_STT_MODEL   - speech to text          (default gpt-4o-transcribe: much better than
//                        the mini model on Twi, Ga and Ewe, still about $0.006 a minute)
//   OPENAI_TTS_MODEL   - text to speech          (default gpt-4o-mini-tts)
//   OPENAI_TTS_VOICE   - female voice            (default nova)
//   OPENAI_REALTIME_MODEL - live voice mode      (default gpt-realtime-mini)
//   OPENAI_REALTIME_VOICE - live voice           (default marin)

const BASE = "https://api.openai.com/v1";

function cfg() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set on the server");
  return {
    key,
    chat: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    stt: process.env.OPENAI_STT_MODEL || "gpt-4o-transcribe",
    tts: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    voice: process.env.OPENAI_TTS_VOICE || "nova",
  };
}

async function fail(res: Response, what: string): Promise<never> {
  const body = await res.text().catch(() => "");
  let msg = body;
  try {
    msg = JSON.parse(body).error?.message ?? body;
  } catch {
    /* plain text */
  }
  throw new Error(`OpenAI ${what} failed (${res.status}): ${msg.slice(0, 300)}`);
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function chatCompletion(
  messages: ChatMessage[],
  opts: { jsonSchema?: { name: string; schema: Record<string, unknown> }; maxTokens?: number } = {},
) {
  const c = cfg();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: c.chat,
      messages,
      temperature: 0.6,
      max_tokens: opts.maxTokens ?? 600,
      ...(opts.jsonSchema && {
        response_format: {
          type: "json_schema",
          json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: true },
        },
      }),
    }),
  });
  if (!res.ok) await fail(res, "chat");
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "";
}

export async function transcribe(audio: Uint8Array, mimeType: string, lang: SpeechLang = "auto") {
  const c = cfg();
  const ext =
    [
      ["mp4", "mp4"],
      ["m4a", "m4a"],
      ["ogg", "ogg"],
      ["mpeg", "mp3"],
      ["mp3", "mp3"],
      ["wav", "wav"],
    ].find(([k]) => mimeType.includes(k))?.[1] ?? "webm";
  const form = new FormData();
  form.append(
    "file",
    new Blob([audio as Uint8Array<ArrayBuffer>], { type: mimeType }),
    `speech.${ext}`,
  );
  form.append("model", c.stt);
  form.append("prompt", STT_PROMPT[lang]);
  const iso = STT_ISO[lang];
  if (iso) form.append("language", iso);
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.key}` },
    body: form,
  });
  if (!res.ok) await fail(res, "transcription");
  const text = ((await res.json()) as { text: string }).text.trim();
  // On silence or noise the model can repeat the hint prompt back; that isn't speech.
  return isPromptEcho(text, lang) ? "" : text;
}

/** Text to speech. Without a language, she speaks whatever language the text is written in. */
export async function speak(text: string, language?: string) {
  const c = cfg();
  const res = await fetch(`${BASE}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: c.tts,
      voice: c.voice,
      input: text,
      response_format: "mp3",
      instructions: `${
        language
          ? `Speak in ${language}`
          : "Speak in the language the text is written in (it may be English, Twi, Ga, Ewe, Hausa or French)"
      } with natural native Ghanaian pronunciation. Warm, friendly, clear female farm advisor.`,
    }),
  });
  if (!res.ok) await fail(res, "speech");
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Short-lived client secret for a Realtime (speech-to-speech) session. The
 * browser uses it to open a WebRTC call straight to OpenAI, so audio never
 * round-trips through this server and the real API key stays here.
 */
export async function createRealtimeClientSecret(
  instructions: string,
  lang: SpeechLang = "auto",
  opts: { manualResponse?: boolean } = {},
) {
  const c = cfg();
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";
  const res = await fetch(`${BASE}/realtime/client_secrets`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.key}`, "content-type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 120 },
      session: {
        type: "realtime",
        model,
        instructions,
        audio: {
          input: {
            noise_reduction: { type: "far_field" },
            transcription: {
              model: c.stt,
              prompt: STT_PROMPT[lang],
              ...(STT_ISO[lang] && { language: STT_ISO[lang] }),
            },
            // manualResponse: the browser sends response.create itself once it has
            // checked the farmer's language (Twi turns are answered elsewhere).
            turn_detection: {
              type: "semantic_vad",
              // With routing, a little more patience: a reply cut off by the next
              // breath costs a whole Twi turn (they take a few seconds).
              eagerness: opts.manualResponse ? "medium" : "high",
              ...(opts.manualResponse && { create_response: false, interrupt_response: true }),
            },
          },
          output: { voice: process.env.OPENAI_REALTIME_VOICE || "marin" },
        },
      },
    }),
  });
  if (!res.ok) await fail(res, "realtime session");
  const data = (await res.json()) as { value: string; expires_at: number };
  return { clientSecret: data.value, expiresAt: data.expires_at, model };
}

export function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
