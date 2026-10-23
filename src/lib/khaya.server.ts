import process from "node:process";
import { KHAYA_CODES, type SpeechLang } from "./ai-languages";

// GhanaNLP Khaya API (https://translation.ghananlp.org): speech recognition,
// translation and voices trained on Ghanaian languages. Ama uses it for Twi, Ga,
// Ewe and Hausa, where it sounds far more natural than OpenAI's models.
// Server-only: KHAYA_API_KEY never reaches the browser. Without a key, everything
// falls back to OpenAI.
//
//   KHAYA_API_KEY   - subscription key from translation.ghananlp.org (required to enable)
//   KHAYA_TTS_VOICE - female | male_low | male_high          (default female)

const BASE = "https://translation-api.ghananlp.org";

export const khayaEnabled = () => Boolean(process.env.KHAYA_API_KEY);

function headers(contentType: string) {
  const key = process.env.KHAYA_API_KEY;
  if (!key) throw new Error("KHAYA_API_KEY is not set on the server");
  return {
    "Ocp-Apim-Subscription-Key": key,
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
  };
}

async function call(path: string, init: RequestInit, what: string) {
  const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = body;
    try {
      const j = JSON.parse(body) as { message?: string; detail?: string };
      msg = j.message ?? j.detail ?? body;
    } catch {
      /* plain text */
    }
    throw new Error(`Khaya ${what} failed (${res.status}): ${String(msg).slice(0, 300)}`);
  }
  return res;
}

/** Speech to text. `wav` should be 16 kHz mono WAV (the browser converts it). */
export async function khayaTranscribe(wav: Uint8Array, lang: SpeechLang) {
  const code = KHAYA_CODES[lang]?.asr;
  if (!code) throw new Error(`Khaya has no speech recognition for ${lang}`);
  const res = await call(
    `/asr/v1/transcribe?language=${code}`,
    { method: "POST", headers: headers("audio/wav"), body: wav as Uint8Array<ArrayBuffer> },
    "transcription",
  );
  // v1 returns a bare JSON string; later versions return { text }.
  const body = (await res.json()) as string | { text?: string };
  return (typeof body === "string" ? body : (body.text ?? "")).trim();
}

/** Translate one piece of text, e.g. pair "en-tw" or "tw-en". */
async function translateOne(text: string, pair: string) {
  const res = await call(
    "/v1/translate",
    {
      method: "POST",
      headers: headers("application/json"),
      body: JSON.stringify({ in: text, lang: pair }),
    },
    "translation",
  );
  const body = (await res.json()) as string | { out?: string; translation?: string };
  return (typeof body === "string" ? body : (body.out ?? body.translation ?? "")).trim();
}

/**
 * Translate between English and a Ghanaian language, line by line so lists and
 * paragraphs keep their shape. Returns null when Khaya can't translate that language.
 */
export async function khayaTranslate(text: string, from: SpeechLang | "en", to: SpeechLang | "en") {
  const code = (l: SpeechLang | "en") => (l === "en" ? "en" : KHAYA_CODES[l]?.mt);
  const a = code(from);
  const b = code(to);
  if (!a || !b || a === b) return null;
  const lines = text.split("\n");
  const out = await Promise.all(
    lines.map(async (line) => {
      const m = line.match(/^(\s*(?:[-*•]|\d+[.)])\s+)?(.*)$/)!;
      const [, bullet = "", body] = m;
      if (!body.trim()) return line;
      return bullet + (await translateOne(body, `${a}-${b}`));
    }),
  );
  return out.join("\n").trim();
}

/** Text to speech in a Ghanaian voice. Returns one WAV file. */
export async function khayaSpeak(text: string, lang: SpeechLang) {
  const code = KHAYA_CODES[lang]?.tts;
  if (!code) throw new Error(`Khaya has no voice for ${lang}`);
  const speaker = process.env.KHAYA_TTS_VOICE || "female";
  // Long replies are spoken in sentence-sized pieces and joined, which keeps
  // each request small and lets them run in parallel.
  const parts = chunkSentences(text, 350);
  const wavs = await Promise.all(
    parts.map(async (p) => {
      const res = await call(
        "/tts/v1/tts",
        {
          method: "POST",
          headers: headers("application/json"),
          body: JSON.stringify({ text: p, language: code, speaker_id: speaker }),
        },
        "speech",
      );
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF")
        throw new Error("Khaya speech returned something that isn't audio");
      return bytes;
    }),
  );
  return joinWavs(wavs);
}

function chunkSentences(text: string, max: number) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + " " + s).length > max) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out.length ? out : [text];
}

/** Concatenate WAV files that share one format (as Khaya's do). */
function joinWavs(wavs: Uint8Array[]) {
  if (wavs.length === 1) return wavs[0];
  const parse = (w: Uint8Array) => {
    const v = new DataView(w.buffer, w.byteOffset, w.byteLength);
    let off = 12;
    let fmt: Uint8Array | null = null;
    while (off + 8 <= w.length) {
      const id = String.fromCharCode(...w.subarray(off, off + 4));
      const size = v.getUint32(off + 4, true);
      if (id === "fmt ") fmt = w.subarray(off, off + 8 + size);
      if (id === "data") return { fmt, data: w.subarray(off + 8, off + 8 + size) };
      off += 8 + size + (size % 2);
    }
    throw new Error("Bad WAV from Khaya");
  };
  const parsed = wavs.map(parse);
  const fmt = parsed[0].fmt!;
  const dataLen = parsed.reduce((n, p) => n + p.data.length, 0);
  const out = new Uint8Array(12 + fmt.length + 8 + dataLen);
  const v = new DataView(out.buffer);
  out.set([82, 73, 70, 70], 0); // RIFF
  v.setUint32(4, out.length - 8, true);
  out.set([87, 65, 86, 69], 8); // WAVE
  out.set(fmt, 12);
  let off = 12 + fmt.length;
  out.set([100, 97, 116, 97], off); // data
  v.setUint32(off + 4, dataLen, true);
  off += 8;
  for (const p of parsed) {
    out.set(p.data, off);
    off += p.data.length;
  }
  return out;
}
