import process from "node:process";
import { query, queryOne } from "./db.server";
import { DEFAULT_VOICE, type VoiceChoice } from "./voice-choice";

// Ama's Twi voice from GhanaNLP's stable-twi-tts, running on the farm's
// Raspberry Pi (edge/twi_tts.py). Two ways to reach it:
//
//   TWI_TTS_URL set  -> call it directly (Pi on the same network, or behind a tunnel)
//                       POST {url}/synthesize { text, voice } -> audio/wav
//                       with "authorization: Bearer TWI_TTS_TOKEN" when that is set
//   otherwise        -> relay through the database: queue the text in tts_jobs and wait
//                       for the Pi, which polls /api/public/devices/tts, to upload the WAV.
//                       Works behind any router, with the Pi's existing device key.
//
// Voices: the account's choice (Profile) picks male twi-6 (about 120 Hz) or female twi-1
// (about 190 Hz). TWI_TTS_VOICE_MALE / TWI_TTS_VOICE_FEMALE swap in other stable-twi-tts voices.

const VOICE = (v: VoiceChoice) =>
  v === "female"
    ? process.env.TWI_TTS_VOICE_FEMALE || "twi-1"
    : process.env.TWI_TTS_VOICE_MALE || "twi-6";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when some Pi's voice service polled in the last minute (or a direct URL is set). */
export async function twiVoiceOnline() {
  if (process.env.TWI_TTS_URL) return true;
  const row = await queryOne<{ n: number }>(
    "select count(*)::int as n from devices where tts_seen_at > now() - interval '1 minute'",
  ).catch(() => null);
  return Boolean(row?.n);
}

/**
 * Someone is about to talk to Ama in Twi: tell the Pi to poll every second for
 * the next five minutes, so replies don't wait for its slow 20 s poll.
 */
export async function wakeTwiVoice() {
  if (process.env.TWI_TTS_URL) return;
  await query(
    `update devices set tts_wanted_until = now() + interval '5 minutes'
      where tts_seen_at > now() - interval '2 minutes'`,
  ).catch(() => {});
}

/**
 * Speak Twi text on the Pi (or this PC). Returns WAV bytes, or throws if it isn't
 * reachable within timeoutMs. Callers send one sentence at a time, so a short
 * timeout is plenty and a slow machine falls back to another voice quickly.
 */
export async function twiSpeak(
  text: string,
  voice: VoiceChoice = DEFAULT_VOICE,
  timeoutMs = 12_000,
): Promise<Uint8Array> {
  const url = process.env.TWI_TTS_URL;
  if (url) {
    const token = process.env.TWI_TTS_TOKEN;
    const res = await fetch(`${url.replace(/\/$/, "")}/synthesize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ text, voice: VOICE(voice) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Twi voice server failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  return relaySpeak(text, VOICE(voice), timeoutMs + 3_000);
}

async function relaySpeak(text: string, voiceId: string, timeoutMs: number) {
  if (!(await twiVoiceOnline())) throw new Error("No Pi is running the Twi voice service");
  await wakeTwiVoice();
  // Tidy up old jobs (and their audio) while we're here.
  void query("delete from tts_jobs where created_at < now() - interval '10 minutes'").catch(
    () => {},
  );
  const job = await queryOne<{ id: string }>(
    "insert into tts_jobs (text, voice) values ($1, $2) returning id",
    [text, voiceId],
  );
  const id = job!.id;
  // A Pi that is polling fast picks it up within a second; give up after
  // timeoutMs so the caller can fall back to another voice.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(350);
    const row = await queryOne<{ status: string; audio: string | null; error: string | null }>(
      "select status, audio, error from tts_jobs where id = $1",
      [id],
    );
    if (row?.status === "done" && row.audio) {
      void query("update tts_jobs set audio = null where id = $1", [id]).catch(() => {});
      return Uint8Array.from(atob(row.audio), (c) => c.charCodeAt(0));
    }
    if (row?.status === "error") throw new Error(`Pi Twi voice failed: ${row.error ?? "unknown"}`);
  }
  await query("update tts_jobs set status = 'error', error = 'timed out' where id = $1", [id]);
  throw new Error("The Pi took too long to speak");
}
