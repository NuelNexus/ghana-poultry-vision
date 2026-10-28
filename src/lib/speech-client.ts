// Browser side of everything the site says out loud: Ama's replies, read-aloud,
// page explanations, the language greetings.
//
// Text is split into sentences. The first one is fetched and played straight
// away, the next two are fetched while it plays, so the farmer hears her within
// about a second even for long replies (instead of waiting for the whole reply
// to be synthesised). If the Twi voice is slow or offline for one sentence, the
// rest of the reply skips it and uses the next voice, so it never stalls twice.

export type SpokenChunk = { audio: string; mimeType: string; engine?: string; text?: string };
/** Fetches audio for one sentence. slowTwi: the Twi voice already timed out in this reply. */
export type FetchChunk = (text: string, slowTwi: boolean) => Promise<SpokenChunk>;

const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/** Sentences sized for speech: short first piece (fast start), nothing over ~220 characters. */
export function splitForSpeech(text: string, max = 220): string[] {
  const clean = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .trim();
  const parts = clean
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const pieces = p.length > max ? p.split(/(?<=[,;:])\s+/) : [p];
    for (const q of pieces) {
      const last = out[out.length - 1];
      if (last && (last.length < 40 || q.length < 12) && last.length + q.length + 1 <= max) {
        out[out.length - 1] = `${last} ${q}`;
      } else out.push(q.length > max * 1.5 ? q.slice(0, max * 1.5) : q);
    }
  }
  return out;
}

// Recently fetched sentences, shared by every player (Listen twice = no second request).
const chunkCache = new Map<string, Promise<SpokenChunk>>();
export function cachedChunk(key: string, get: () => Promise<SpokenChunk>) {
  let p = chunkCache.get(key);
  if (!p) {
    p = get();
    chunkCache.set(key, p);
    p.catch(() => chunkCache.delete(key));
    while (chunkCache.size > 120) chunkCache.delete(chunkCache.keys().next().value!);
  }
  return p;
}

const players = new Set<SpeechPlayer>();

/** Plays text sentence by sentence. Only one player on the page talks at a time. */
export class SpeechPlayer {
  readonly el: HTMLAudioElement;
  playingId: string | null = null;
  onChange: ((playingId: string | null) => void) | null = null;
  private seq = 0;
  private url: string | null = null;
  private finish: (() => void) | null = null;
  private browserVoice = false;

  constructor(el?: HTMLAudioElement) {
    this.el = el ?? new Audio();
    this.el.setAttribute("playsinline", "");
    this.el.preload = "auto";
    players.add(this);
  }

  dispose() {
    this.stop();
    players.delete(this);
    if (this.url) URL.revokeObjectURL(this.url);
  }

  /** Call inside a tap: phones only allow sound that starts from a user gesture. */
  unlock() {
    if (this.playingId) return;
    this.el.src = SILENCE;
    void this.el.play().catch(() => {});
  }

  stop() {
    this.seq++;
    if (!this.el.paused) this.el.pause();
    if (this.browserVoice && typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.browserVoice = false;
    this.finish?.();
    this.finish = null;
    this.set(null);
  }

  get busy() {
    return this.playingId !== null;
  }

  /**
   * Speak text. Resolves when it has all been played or someone stopped it.
   * Throws only if the first sentence can't be fetched or played.
   */
  async speak(id: string, text: string, fetchChunk: FetchChunk, opts: { twi?: boolean } = {}) {
    for (const p of players) if (p !== this) p.stop();
    this.stop();
    const my = this.seq;
    const chunks = splitForSpeech(text);
    if (!chunks.length) return;
    this.set(id);

    let slowTwi = false;
    const reqs: Promise<SpokenChunk>[] = [];
    const get = (i: number) =>
      (reqs[i] ??= fetchChunk(chunks[i], slowTwi).then((r) => {
        if (opts.twi && r.engine && r.engine !== "twi") slowTwi = true;
        return r;
      }));
    get(0);
    if (chunks.length > 1) get(1);

    for (let i = 0; i < chunks.length; i++) {
      let r: SpokenChunk;
      try {
        r = await get(i);
      } catch (err) {
        if (my !== this.seq) return;
        if (i === 0) {
          this.set(null);
          throw err;
        }
        continue; // one sentence failed: carry on with the rest
      }
      if (my !== this.seq) return;
      if (i + 2 < chunks.length) void get(i + 2).catch(() => {});
      try {
        await this.playOne(r, my);
      } catch (err) {
        if (my === this.seq) this.set(null);
        throw err;
      }
      if (my !== this.seq) return;
    }
    this.set(null);
  }

  private playOne(r: SpokenChunk, my: number) {
    if (r.engine === "browser") return this.sayInBrowser(r.text ?? "", my);
    if (this.url) URL.revokeObjectURL(this.url);
    const bytes = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
    this.url = URL.createObjectURL(new Blob([bytes], { type: r.mimeType }));
    this.el.src = this.url;
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        this.el.removeEventListener("ended", done);
        this.el.removeEventListener("error", done);
        if (this.finish === done) this.finish = null;
        resolve();
      };
      this.finish = done;
      this.el.addEventListener("ended", done);
      this.el.addEventListener("error", done);
      this.el.play().catch((err) => {
        if (my !== this.seq) return resolve();
        done();
        reject(err);
      });
    });
  }

  /** No server voice (offline): the browser's built-in voice reads the sentence. */
  private sayInBrowser(text: string, my: number) {
    if (typeof speechSynthesis === "undefined" || !text) return Promise.resolve();
    this.browserVoice = true;
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const done = () => {
        if (this.finish === done) this.finish = null;
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      this.finish = done;
      if (my !== this.seq) return resolve();
      speechSynthesis.speak(u);
    });
  }

  private set(id: string | null) {
    this.playingId = id;
    this.onChange?.(id);
  }
}

/** Stop whatever the site is saying (e.g. when the farmer starts talking). */
export function stopAllSpeech() {
  for (const p of players) p.stop();
}
