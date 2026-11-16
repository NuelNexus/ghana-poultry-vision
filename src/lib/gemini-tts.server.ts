import process from "node:process";
import type { VoiceChoice } from "./voice-choice";

// Gemini text-to-speech: the site's English voice (and other languages Twi's own voices
// and Khaya don't cover). Needs GEMINI_API_KEY; GEMINI_TTS_MODEL and
// GEMINI_TTS_VOICE_MALE / _FEMALE change the model and voices.
//   Kofi (nelvin, male)  -> Charon
//   Ama  (female)        -> Kore

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const geminiEnabled = () => !!process.env.GEMINI_API_KEY;

// Gemini reads only the TRANSCRIPT; the notes above it set how it is said.
const prompt = (text: string, voice: VoiceChoice, language?: string) => `# AUDIO PROFILE: ${
  voice === "female" ? "Ama" : "Kofi"
}
A friendly Ghanaian poultry farm advisor helping a farmer on the PoultryGrid site.

### DIRECTOR'S NOTES
Style: warm, clear and friendly. Accent: Ghanaian${language ? `. Language: ${language}` : " English"}. Pace: natural.

#### TRANSCRIPT
${text}`;

/** One sentence as a WAV file (24 kHz mono, 16-bit). */
export async function geminiSpeak(
  text: string,
  voice: VoiceChoice,
  language?: string,
): Promise<Uint8Array> {
  const model = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
  const voiceName =
    voice === "female"
      ? process.env.GEMINI_TTS_VOICE_FEMALE || "Kore"
      : process.env.GEMINI_TTS_VOICE_MALE || "Charon";
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt(text, voice, language) }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType: string } }[] } }[];
  };
  const part = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!part) throw new Error("Gemini TTS returned no audio");
  const bytes = Uint8Array.from(Buffer.from(part.data, "base64"));
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return bytes; // already a WAV ("RI"FF)
  const rate = Number(/rate=(\d+)/.exec(part.mimeType)?.[1] ?? 24000);
  return wav(bytes, rate);
}

/** Wraps raw 16-bit mono PCM in a WAV header. */
function wav(pcm: Uint8Array, rate: number) {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}
