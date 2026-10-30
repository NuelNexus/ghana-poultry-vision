import process from "node:process";
import { speak, toBase64 } from "./openai.server";
import { KHAYA_CODES, langName, type SpeechLang } from "./ai-languages";
import { ghanaVoiceSpeak } from "./ghana-voice.server";
import { khayaEnabled, khayaSpeak } from "./khaya.server";
import { twiSpeak } from "./twi-tts.server";
import { DEFAULT_VOICE, type VoiceChoice } from "./voice-choice";

// One voice for the whole site (Ama's replies, read-aloud, page explanations).
// The browser sends one sentence at a time (src/lib/speech-client.ts) and plays
// each as soon as it arrives, so the first words are heard after one short
// synthesis instead of after the whole reply.
//
//   Twi            -> stable-twi-tts (Pi or this PC), then Ghana Voice, then Khaya, then OpenAI
//   Male or female: the account's choice in Profile (default male, twi-6).
//   Ga, Ewe, Dagbani, Hausa -> Ghana Voice (speech/serve.py, when GHANA_VOICE_URL is set and
//                    it has that language), then Khaya when there is a key, then OpenAI
//   anything else  -> OpenAI

export type Spoken = {
  audio: string;
  mimeType: string;
  engine: "twi" | "ghana" | "khaya" | "openai" | "browser";
  /** engine "browser": no audio; the browser reads this text with its own voice (offline). */
  text?: string;
};

// Recently spoken sentences. Menu words, greetings and repeated advice are free the second time.
const cache = new Map<string, Spoken>();
const CACHE_MAX = 300;

const clean = (t: string) =>
  t
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .trim();

export async function speakIn(
  text: string,
  lang: SpeechLang,
  opts: { slowTwi?: boolean; voice?: VoiceChoice } = {},
): Promise<Spoken> {
  const said = clean(text);
  const voice = opts.voice ?? DEFAULT_VOICE;
  const key = `${voice}\u0000${lang}\u0000${said}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // most recent last
    return hit;
  }

  let out: Spoken | null = null;
  // slowTwi: the browser saw the Twi voice time out earlier in this reply, so it
  // skips straight to the next voice instead of waiting again.
  if (lang === "tw" && !opts.slowTwi) {
    try {
      out = { audio: toBase64(await twiSpeak(said, voice)), mimeType: "audio/wav", engine: "twi" };
    } catch {
      /* Pi / PC voice offline or slow: next option */
    }
  }
  // Ghana Voice has one voice per language, so the male/female choice doesn't apply.
  if (!out) {
    try {
      out = {
        audio: toBase64(await ghanaVoiceSpeak(said, lang)),
        mimeType: "audio/wav",
        engine: "ghana",
      };
    } catch {
      /* not set up, no voice for this language, or offline: next option */
    }
  }
  if (!out && khayaEnabled() && KHAYA_CODES[lang]?.tts) {
    try {
      out = {
        audio: toBase64(await khayaSpeak(said, lang, voice)),
        mimeType: "audio/wav",
        engine: "khaya",
      };
    } catch {
      /* fall back to OpenAI */
    }
  }
  if (!out && process.env.OPENAI_API_KEY) {
    try {
      const mp3 = await speak(said, lang === "auto" ? undefined : langName(lang), voice);
      out = { audio: toBase64(mp3), mimeType: "audio/mpeg", engine: "openai" };
    } catch (err) {
      console.warn("[voice]", err instanceof Error ? err.message : err);
    }
  }
  // Offline, or OpenAI out of credit: the browser's own voice reads it (not cached:
  // there is nothing to keep).
  if (!out) return { audio: "", mimeType: "", engine: "browser", text: said };
  cache.set(key, out);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return out;
}
