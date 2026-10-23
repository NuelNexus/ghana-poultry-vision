// Browser audio helpers for the AI tab: microphone checks, short recordings for
// dictation, and a reply player that works on iPhone and Android.

/**
 * Why the mic can't be used here, or null when it can. Phones only allow the
 * microphone on HTTPS pages (or localhost): opening the dev server by its LAN
 * address (http://192.168.x.x) hides navigator.mediaDevices entirely.
 */
export function micUnavailableReason(): string | null {
  if (typeof window === "undefined") return "Not in a browser.";
  if (!window.isSecureContext)
    return "The microphone only works on a secure (https://) page. Open PoultryGrid over HTTPS to talk to Ama.";
  if (!navigator.mediaDevices?.getUserMedia)
    return "This browser can’t use the microphone. Try Chrome or Safari.";
  return null;
}

export function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found on this device.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone is busy in another app (a call or recorder). Close it and try again.";
    default:
      return err instanceof Error ? err.message : String(err);
  }
}

/** Mic constraints that every phone accepts (no exact values that can fail). */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

/** Recording format: Chrome/Android record WebM/Opus, Safari/iPhone record MP4/AAC. */
function recorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}

/** Press-to-start, press-to-stop recorder for dictation. */
export class Recorder {
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private timer = 0;
  /** Loudest moment so far (RMS, 0..1). Near zero means nothing was said. */
  peak = 0;

  /** Must be called from a tap/click so phones show the permission prompt. */
  async start() {
    const why = micUnavailableReason();
    if (why) throw new Error(why);
    if (typeof MediaRecorder === "undefined")
      throw new Error("This browser can’t record audio. Update it, or type your message.");
    this.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    const mime = recorderMime();
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    this.meter(this.stream);
  }

  /** True when the recording had something louder than room hiss. */
  get heardSomething() {
    return this.peak >= 0.012 || !this.ctx;
  }

  private meter(stream: MediaStream) {
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      void this.ctx.resume();
      const an = this.ctx.createAnalyser();
      an.fftSize = 1024;
      this.ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      this.peak = 0;
      this.timer = window.setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        this.peak = Math.max(this.peak, Math.sqrt(sum / buf.length));
      }, 80);
    } catch {
      this.ctx = null; // no meter: just send the audio
    }
  }

  stop(): Promise<Blob | null> {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const type = rec.mimeType || this.chunks[0]?.type || "audio/webm";
        const blob = this.chunks.length ? new Blob(this.chunks, { type }) : null;
        this.release();
        resolve(blob);
      };
      if (rec.state !== "inactive") rec.stop();
      else rec.onstop?.(new Event("stop"));
    });
  }

  cancel() {
    if (this.rec && this.rec.state !== "inactive") {
      this.rec.onstop = null;
      this.rec.stop();
    }
    this.release();
  }

  private release() {
    window.clearInterval(this.timer);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
    this.chunks = [];
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// WAV -------------------------------------------------------------------------
// Khaya's speech recognition wants 16 kHz mono WAV, which no browser records
// natively, so recordings are converted here before upload.

const WAV_RATE = 16_000;

function resample(input: Float32Array, from: number, to = WAV_RATE) {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // Average the source samples this one covers (a cheap low-pass).
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = a; j < b; j++) sum += input[j];
    out[i] = sum / (b - a);
  }
  return out;
}

/** 16-bit PCM WAV from mono samples. */
export function encodeWav(samples: Float32Array, rate = WAV_RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

const audioContextClass = () =>
  window.AudioContext ??
  (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

/** Convert a recording (WebM/MP4) to 16 kHz mono WAV. Returns null if the browser can't decode it. */
export async function toWav16k(blob: Blob): Promise<Blob | null> {
  try {
    const ctx = new (audioContextClass())();
    try {
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      const mono = new Float32Array(decoded.length);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const ch = decoded.getChannelData(c);
        for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / decoded.numberOfChannels;
      }
      return encodeWav(resample(mono, decoded.sampleRate));
    } finally {
      void ctx.close().catch(() => {});
    }
  } catch {
    return null;
  }
}

// Hands-free turns ------------------------------------------------------------

/**
 * Keeps the mic open and hands over one utterance at a time as a 16 kHz WAV:
 * it waits for speech, records until about a second of quiet, then calls
 * onUtterance. Used for the turn-by-turn voice mode (Twi, Ga, Ewe, Hausa).
 */
export class TurnListener {
  onSpeechStart: (() => void) | null = null;
  /** Speech stopped (followed by onUtterance unless it was too short to be words). */
  onSpeechEnd: (() => void) | null = null;
  onUtterance: ((wav: Blob) => void) | null = null;
  /** While paused (Ama thinking or talking), sound is ignored. */
  paused = false;
  private ctx: AudioContext;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private floor = 0.004;
  private speaking = false;
  private loudFrames = 0;
  private quietMs = 0;
  private spokenMs = 0;
  private chunks: Float32Array[] = [];
  private preroll: Float32Array[] = [];

  /** Create inside the tap that starts the call, so iPhones allow the audio context. */
  constructor() {
    this.ctx = new (audioContextClass())();
    void this.ctx.resume();
  }

  async start() {
    const why = micUnavailableReason();
    if (why) throw new Error(why);
    this.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    const src = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is old but works on every phone browser, unlike worklets on older iOS.
    const node = this.ctx.createScriptProcessor(2048, 1, 1);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    src.connect(node);
    node.connect(mute);
    mute.connect(this.ctx.destination);
    node.onaudioprocess = (e) => this.frame(new Float32Array(e.inputBuffer.getChannelData(0)));
    this.node = node;
    await this.ctx.resume();
  }

  private frame(buf: Float32Array) {
    const ms = (buf.length / this.ctx.sampleRate) * 1000;
    if (this.paused) {
      this.reset();
      return;
    }
    let sum = 0;
    for (const v of buf) sum += v * v;
    const rms = Math.sqrt(sum / buf.length);
    const loud = rms > Math.max(0.012, this.floor * 3);
    if (!this.speaking) {
      // Track the room's noise level so a fan or a generator doesn't count as speech.
      if (!loud) this.floor = this.floor * 0.95 + rms * 0.05;
      this.preroll.push(buf);
      if (this.preroll.length > 8) this.preroll.shift();
      this.loudFrames = loud ? this.loudFrames + 1 : 0;
      if (this.loudFrames >= 3) {
        this.speaking = true;
        this.chunks = [...this.preroll];
        this.quietMs = 0;
        this.spokenMs = 0;
        this.onSpeechStart?.();
      }
      return;
    }
    this.chunks.push(buf);
    this.spokenMs += ms;
    this.quietMs = loud ? 0 : this.quietMs + ms;
    if (this.quietMs > 1100 || this.spokenMs > 25_000) this.finish();
  }

  private finish() {
    const chunks = this.chunks;
    const longEnough = this.spokenMs - this.quietMs > 350;
    this.reset();
    this.onSpeechEnd?.();
    if (!longEnough) return;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let off = 0;
    for (const c of chunks) {
      all.set(c, off);
      off += c.length;
    }
    this.onUtterance?.(encodeWav(resample(all, this.ctx.sampleRate)));
  }

  private reset() {
    this.speaking = false;
    this.loudFrames = 0;
    this.chunks = [];
    this.preroll = [];
  }

  stop() {
    this.onSpeechStart = null;
    this.onSpeechEnd = null;
    this.onUtterance = null;
    if (this.node) this.node.onaudioprocess = null;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx.close().catch(() => {});
  }
}

// A tiny silent WAV. Playing it inside a tap "unlocks" the element, so iPhones
// let us play Ama's reply later, after the network round trip.
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/** One reusable <audio> for spoken replies. Call unlock() from a tap first. */
export class ReplyPlayer {
  readonly el: HTMLAudioElement;
  private url: string | null = null;
  onChange: ((playingId: string | null) => void) | null = null;
  playingId: string | null = null;

  constructor() {
    this.el = new Audio();
    this.el.setAttribute("playsinline", "");
    this.el.preload = "auto";
    // No controls are shown, so it only stops by ending or through stop().
    this.el.addEventListener("ended", () => this.set(null));
  }

  unlock() {
    if (this.playingId) return;
    this.el.src = SILENCE;
    void this.el.play().catch(() => {});
  }

  async play(id: string, base64: string, mime: string) {
    this.stop();
    if (this.url) URL.revokeObjectURL(this.url);
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    this.url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    this.el.src = this.url;
    this.set(id);
    try {
      await this.el.play();
    } catch (err) {
      this.set(null);
      throw err;
    }
  }

  stop() {
    if (!this.el.paused) this.el.pause();
    this.set(null);
  }

  private set(id: string | null) {
    this.playingId = id;
    this.onChange?.(id);
  }
}
