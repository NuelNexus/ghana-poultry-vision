import process from "node:process";
import type { SpeechLang } from "./ai-languages";

// Ghana Voice (speech/serve.py): our own voices for Twi, Ewe, Hausa, Dagbani, Ga and
// more, running on the Pi, this PC or any server. Free and offline-capable, so it comes
// before Khaya and OpenAI for the languages it serves.
//
//   GHANA_VOICE_URL    where serve.py listens, e.g. http://raspberrypi.local:5003
//   GHANA_VOICE_TOKEN  same value as on the server (sent as a bearer token)
//
// The server answers 404 for a language it has no voice for; the caller then moves on.

// App language -> Ghana Voice code (the same codes today; kept explicit on purpose).
const CODES: Partial<Record<SpeechLang, string>> = {
  tw: "tw",
  ga: "ga",
  ee: "ee",
  dag: "dag",
  ha: "ha",
};

let known: { at: number; langs: Set<string> } | null = null;

export const ghanaVoiceEnabled = () => Boolean(process.env.GHANA_VOICE_URL);

const base = () => process.env.GHANA_VOICE_URL!.replace(/\/$/, "");

/** Languages the server speaks, checked at most once a minute. Empty when it's unreachable. */
async function languages(): Promise<Set<string>> {
  if (known && Date.now() - known.at < 60_000) return known.langs;
  let langs = new Set<string>();
  try {
    const res = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) langs = new Set(((await res.json()) as { languages?: string[] }).languages ?? []);
  } catch {
    /* offline: try again next minute */
  }
  known = { at: Date.now(), langs };
  return langs;
}

export async function ghanaVoiceSpeaks(lang: SpeechLang) {
  const code = CODES[lang];
  return Boolean(code && ghanaVoiceEnabled() && (await languages()).has(code));
}

/** WAV bytes, or throws (not configured, no voice for the language, slow or offline). */
export async function ghanaVoiceSpeak(
  text: string,
  lang: SpeechLang,
  timeoutMs = 12_000,
): Promise<Uint8Array> {
  if (!(await ghanaVoiceSpeaks(lang))) throw new Error(`Ghana Voice has no ${lang} voice`);
  const token = process.env.GHANA_VOICE_TOKEN;
  const res = await fetch(`${base()}/synthesize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ text, lang: CODES[lang] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ghana Voice failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
