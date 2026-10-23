import { speak, toBase64 } from "./openai.server";
import { KHAYA_CODES, langName, type SpeechLang } from "./ai-languages";
import { khayaEnabled, khayaSpeak } from "./khaya.server";
import { twiSpeak } from "./twi-tts.server";

// One voice for the whole site (Ama's replies, read-aloud, page explanations).
// The browser sends one sentence at a time (src/lib/speech-client.ts) and plays
// each as soon as it arrives, so the first words are heard after one short
// synthesis instead of after the whole reply.
//
//   Twi            -> stable-twi-tts (female twi-1, Pi or this PC), then Khaya, then OpenAI
//   Ga, Ewe, Dagbani, Hausa -> Khaya when there is a key, then OpenAI
//   anything else  -> OpenAI (female "nova")

export type Spoken = { audio: string; mimeType: string; engine: "twi" | "khaya" | "openai" };

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
  opts: { slowTwi?: boolean } = {},
): Promise<Spoken> {
  const said = clean(text);
  const key = `${lang}\u0000${said}`;
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
      out = { audio: toBase64(await twiSpeak(said)), mimeType: "audio/wav", engine: "twi" };
    } catch {
      /* Pi / PC voice offline or slow: next option */
    }
  }
  if (!out && khayaEnabled() && KHAYA_CODES[lang]?.tts) {
    try {
      out = {
        audio: toBase64(await khayaSpeak(said, lang)),
        mimeType: "audio/wav",
        engine: "khaya",
      };
    } catch {
      /* fall back to OpenAI */
    }
  }
  if (!out) {
    const mp3 = await speak(said, lang === "auto" ? undefined : langName(lang));
    out = { audio: toBase64(mp3), mimeType: "audio/mpeg", engine: "openai" };
  }
  cache.set(key, out);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return out;
}
