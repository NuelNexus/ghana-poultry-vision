import process from "node:process";
import type { SpeechLang } from "./ai-languages";

// Offline AI on the farm's own computer: no internet, no bill.
//
//   LOCAL_LLM_URL    - Ollama, e.g. http://127.0.0.1:11434. Ama thinks with it first;
//                      OpenAI is only the fallback (if OPENAI_API_KEY is set).
//   LOCAL_LLM_MODEL  - the Ollama model, default gemma3:4b
//   TWI_OFFLINE_URL  - edge/twi_offline.py, e.g. http://127.0.0.1:5004: NLLB-200
//                      translation (Twi, Ewe, Hausa, French <-> English) and GhanaNLP's
//                      Griot speech recognition for Twi / Ghanaian English
//   TWI_OFFLINE_TOKEN - bearer token, when the service sets PG_OFFLINE_TOKEN
//   AI_PROVIDER      - "local" (default when LOCAL_LLM_URL is set) or "openai"

export const localLlmEnabled = () => Boolean(process.env.LOCAL_LLM_URL);
export const offlineTwiEnabled = () => Boolean(process.env.TWI_OFFLINE_URL);
/** Which brain answers first. */
export const aiProvider = (): "local" | "openai" =>
  process.env.AI_PROVIDER === "openai" || !localLlmEnabled() ? "openai" : "local";

export type LocalMessage = { role: "system" | "user" | "assistant"; content: string };

/** One chat reply from Ollama's OpenAI-compatible endpoint. */
export async function localChat(
  messages: LocalMessage[],
  opts: {
    jsonSchema?: { name: string; schema: Record<string, unknown> };
    maxTokens?: number;
    timeoutMs?: number;
  } = {},
) {
  const base = process.env.LOCAL_LLM_URL!.replace(/\/$/, "");
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // A laptop CPU writes a few words a second: give it time.
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
    body: JSON.stringify({
      model: process.env.LOCAL_LLM_MODEL || "gemma3:4b",
      messages,
      temperature: 0.5,
      max_tokens: opts.maxTokens ?? 600,
      ...(opts.jsonSchema && {
        response_format: {
          type: "json_schema",
          json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema },
        },
      }),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Local AI (Ollama) failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "";
}

// NLLB-200 language codes the offline service knows. Ga and Dagbani aren't in NLLB.
const NLLB: Partial<Record<SpeechLang | "en", string>> = {
  en: "eng_Latn",
  tw: "twi_Latn",
  ee: "ewe_Latn",
  ha: "hau_Latn",
  fr: "fra_Latn",
};
export const offlineTranslates = (lang: SpeechLang) =>
  offlineTwiEnabled() && lang !== "en" && Boolean(NLLB[lang]);

async function service(path: string, init: RequestInit & { timeoutMs?: number }) {
  const base = process.env.TWI_OFFLINE_URL!.replace(/\/$/, "");
  const token = process.env.TWI_OFFLINE_TOKEN;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token && { authorization: `Bearer ${token}` }) },
    signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
  });
  if (!res.ok) throw new Error(`Offline Twi service ${path} failed (${res.status})`);
  return res.json();
}

/** Translate between English and Twi / Ewe / Hausa / French on this computer. */
export async function offlineTranslate(
  text: string,
  from: SpeechLang | "en",
  to: SpeechLang | "en",
) {
  const src = NLLB[from];
  const tgt = NLLB[to];
  if (!src || !tgt) throw new Error(`No offline translation for ${from} -> ${to}`);
  const out = (await service("/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, src, tgt }),
  })) as { text: string };
  return out.text.trim();
}

/** Many strings at once (site text), one request. */
export async function offlineTranslateMany(
  texts: string[],
  from: SpeechLang | "en",
  to: SpeechLang | "en",
) {
  const src = NLLB[from];
  const tgt = NLLB[to];
  if (!src || !tgt) throw new Error(`No offline translation for ${from} -> ${to}`);
  const out = (await service("/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ texts, src, tgt }),
    timeoutMs: 180_000,
  })) as { texts: string[] };
  return out.texts.map((t) => t.trim());
}

/** Twi / Ghanaian English speech (16 kHz WAV) to text with Griot, on this computer. */
export async function offlineTranscribe(wav: Uint8Array) {
  const out = (await service("/transcribe", {
    method: "POST",
    headers: { "content-type": "audio/wav" },
    body: wav as Uint8Array<ArrayBuffer>,
    timeoutMs: 90_000,
  })) as { text: string };
  return out.text.trim();
}

/** What the offline service can do right now (nothing when it isn't running). */
export async function offlineHealth(): Promise<{ translate: boolean; asr: boolean }> {
  if (!offlineTwiEnabled()) return { translate: false, asr: false };
  try {
    return (await service("/health", { method: "GET", timeoutMs: 3_000 })) as {
      translate: boolean;
      asr: boolean;
    };
  } catch {
    return { translate: false, asr: false };
  }
}
