import process from "node:process";
import type { VoiceChoice } from "./voice-choice";

// ElevenLabs text-to-speech: the site's English voice (and other languages that Twi's own
// voices and Khaya don't cover). Needs ELEVENLABS_API_KEY. ELEVENLABS_SITE_MODEL and
// ELEVENLABS_VOICE_MALE / _FEMALE change the model and voices.
//   Kofi (nelvin, male)  -> George, warm storyteller (also the guide videos' narrator)
//   Ama  (female)        -> Alice, clear educator
// Flash is the low-latency model: the first words are heard sooner, at half the credits.

export const elevenEnabled = () => !!process.env.ELEVENLABS_API_KEY;

/** One sentence as an MP3. */
export async function elevenSpeak(text: string, voice: VoiceChoice): Promise<Uint8Array> {
  const voiceId =
    voice === "female"
      ? process.env.ELEVENLABS_VOICE_FEMALE || "Xb7hH8MSUJpSbSDYk0k2"
      : process.env.ELEVENLABS_VOICE_MALE || "JBFqnCBsd6RMkjVDRZzb";
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY!,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_SITE_MODEL || "eleven_flash_v2_5",
        voice_settings: { stability: 0.55, similarity_boost: 0.8 },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return new Uint8Array(await res.arrayBuffer());
}
