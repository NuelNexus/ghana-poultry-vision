// Translates the whole site in place, without touching any page's code.
//
// It walks the page's text (and placeholders, labels, tooltips), sends English
// strings it hasn't seen to the server in batches, and swaps the translations
// in. A MutationObserver keeps up as React renders new screens. When React
// changes a text we translated, the new English is picked up and translated too.
//
// Not translated: anything inside translate="no" / .notranslate (brand name,
// chat messages already in the farmer's language), form values, code, SVG
// charts, and strings without words (numbers, times, units, ids).
//
// Numbers become placeholders before translating ("3 alerts" -> "⟦0⟧ alerts"),
// so one translation covers every count, reading and time.

import type { SiteLang } from "./site-lang";

export type TranslateBatch = (lang: SiteLang, texts: string[]) => Promise<(string | null)[]>;

const SKIP =
  "script,style,noscript,code,pre,textarea,svg,canvas,[translate='no'],.notranslate,[contenteditable='true'],[data-no-translate]";
const ATTRS = ["placeholder", "aria-label", "title", "alt"] as const;
const NUM = /\d+(?:[.,:]\d+)*/g;
const STORE = (lang: string) => `pg-tr:v1:${lang}`;

type Template = { key: string; nums: string[]; lead: string; trail: string };

function toTemplate(raw: string): Template | null {
  const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  const body = m[2];
  if (body.length < 2 || body.length > 600) return null;
  const nums: string[] = [];
  const key = body.replace(NUM, (n) => `⟦${nums.push(n) - 1}⟧`);
  const words = key.replace(/⟦\d+⟧/g, " ");
  if (!/\p{L}{2,}/u.test(words)) return null; // no words: 12:04, 28.1 °C, 45%
  if (/[@/\\]|https?:/.test(body) && !/\s/.test(body)) return null; // emails, paths, urls
  if (!/\s/.test(body) && /[\d_]/.test(body)) return null; // ids like pi-01, house_2
  return { key, nums, lead: m[1], trail: m[3] };
}

const fill = (t: Template, translated: string) =>
  t.lead + translated.replace(/⟦(\d+)⟧/g, (_, i) => t.nums[Number(i)] ?? "") + t.trail;

type Target = { node: Text } | { el: Element; attr: string };

export class DomTranslator {
  private dict = new Map<string, string>();
  private failed = new Set<string>();
  private waiting = new Map<string, Set<Target>>();
  private queue = new Set<string>();
  private timer: number | null = null;
  private observer: MutationObserver | null = null;
  /** English originals of everything we changed, so switching back to English restores them. */
  private textOrig = new Map<Text, { orig: string; shown: string }>();
  private attrOrig = new Map<Element, Map<string, { orig: string; shown: string }>>();
  private saveTimer: number | null = null;
  onPending: ((n: number) => void) | null = null;

  constructor(
    readonly lang: SiteLang,
    private batch: TranslateBatch,
  ) {
    try {
      const raw = localStorage.getItem(STORE(lang));
      if (raw)
        for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>))
          this.dict.set(k, v);
    } catch {
      /* private mode or bad data: start empty */
    }
  }

  /** Look up a translation for a whole string (sync, from what's already loaded). */
  lookup(s: string) {
    const t = toTemplate(s);
    if (!t) return s;
    const hit = this.dict.get(t.key);
    return hit ? fill(t, hit) : null;
  }

  /** Translate arbitrary strings (e.g. a greeting) and wait for the result. */
  async translate(texts: string[]) {
    const ts = texts.map(toTemplate);
    const need = [
      ...new Set(ts.filter((t): t is Template => !!t && !this.dict.has(t.key)).map((t) => t.key)),
    ];
    if (need.length) await this.fetch(need);
    return texts.map((s, i) => {
      const t = ts[i];
      const hit = t && this.dict.get(t.key);
      return t && hit ? fill(t, hit) : s;
    });
  }

  start(root: Node = document.body) {
    this.walk(root);
    this.observer = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "characterData") this.text(m.target as Text);
        else if (m.type === "attributes") {
          const el = m.target as Element;
          // React mirrors typed input into value="": only button labels are site text.
          if (
            m.attributeName === "value" &&
            !(el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button"))
          )
            continue;
          if (!this.skipped(el)) this.attr(el, m.attributeName!);
        } else m.addedNodes.forEach((n) => this.walk(n));
      }
    });
    this.observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRS, "value"],
    });
  }

  /** Stop and put the English back. */
  stop() {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer) window.clearTimeout(this.timer);
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    for (const [node, { orig, shown }] of this.textOrig) {
      if (node.isConnected && node.data === shown) node.data = orig;
    }
    for (const [el, attrs] of this.attrOrig) {
      for (const [a, { orig, shown }] of attrs) {
        if (el.isConnected && el.getAttribute(a) === shown) el.setAttribute(a, orig);
      }
    }
    this.textOrig.clear();
    this.attrOrig.clear();
  }

  private skipped(el: Element | null) {
    return !el || Boolean(el.closest(SKIP));
  }

  private walk(n: Node) {
    if (n.nodeType === Node.TEXT_NODE) return this.text(n as Text);
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (this.skipped(el)) return;
    for (const a of ATTRS) if (el.hasAttribute(a)) this.attr(el, a);
    if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button"))
      this.attr(el, "value");
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (x) =>
        x.nodeType === Node.ELEMENT_NODE
          ? (x as Element).matches(SKIP)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP
          : NodeFilter.FILTER_ACCEPT,
    });
    const texts: Text[] = [];
    const els: Element[] = [];
    for (let x = w.nextNode(); x; x = w.nextNode()) texts.push(x as Text);
    el.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(",")).forEach((e) => els.push(e));
    texts.forEach((t) => this.text(t));
    els.forEach((e) => {
      if (this.skipped(e)) return;
      for (const a of ATTRS) if (e.hasAttribute(a)) this.attr(e, a);
    });
  }

  private text(node: Text) {
    const rec = this.textOrig.get(node);
    if (rec && node.data === rec.shown) return; // our own change
    if (this.skipped(node.parentElement)) return;
    const t = toTemplate(node.data);
    if (!t) return;
    const orig = node.data;
    const hit = this.dict.get(t.key);
    if (hit) {
      const shown = fill(t, hit);
      this.textOrig.set(node, { orig, shown });
      if (node.data !== shown) node.data = shown;
    } else this.want(t.key, { node });
  }

  private attr(el: Element, a: string) {
    const v = el.getAttribute(a);
    if (v == null) return;
    const recs = this.attrOrig.get(el);
    const rec = recs?.get(a);
    if (rec && v === rec.shown) return;
    const t = toTemplate(v);
    if (!t) return;
    const hit = this.dict.get(t.key);
    if (hit) {
      const shown = fill(t, hit);
      const m = recs ?? new Map();
      m.set(a, { orig: v, shown });
      this.attrOrig.set(el, m);
      if (v !== shown) el.setAttribute(a, shown);
    } else this.want(t.key, { el, attr: a });
  }

  private want(key: string, target: Target) {
    if (this.failed.has(key)) return;
    let set = this.waiting.get(key);
    if (!set) this.waiting.set(key, (set = new Set()));
    set.add(target);
    this.queue.add(key);
    if (!this.timer) this.timer = window.setTimeout(() => void this.flush(), 60);
  }

  private async flush() {
    this.timer = null;
    const keys = [...this.queue];
    this.queue.clear();
    // Prune bookkeeping for nodes React has removed.
    if (this.textOrig.size > 4000)
      for (const n of this.textOrig.keys()) if (!n.isConnected) this.textOrig.delete(n);
    if (this.attrOrig.size > 2000)
      for (const e of this.attrOrig.keys()) if (!e.isConnected) this.attrOrig.delete(e);
    const parts: Promise<void>[] = [];
    for (let i = 0; i < keys.length; i += 48) parts.push(this.fetch(keys.slice(i, i + 48)));
    await Promise.all(parts);
  }

  private inflight = new Map<string, Promise<void>>();
  private pending = 0;

  private async fetch(keys: string[]) {
    const mine = keys.filter((k) => !this.inflight.has(k) && !this.dict.has(k));
    const wait = keys.map((k) => this.inflight.get(k)).filter(Boolean) as Promise<void>[];
    if (mine.length) {
      this.pending += mine.length;
      this.onPending?.(this.pending);
      const job = this.batch(this.lang, mine)
        .then((out) => {
          this.retries = 0;
          mine.forEach((k, i) => {
            const v = out[i];
            if (v) this.dict.set(k, v);
            else this.failed.add(k); // keep English; don't ask again this visit
          });
          this.save();
          for (const k of mine) this.apply(k);
        })
        .catch(() => {
          // Server error, offline or rate limited: ask again shortly. A quiet page
          // (the sign-in form) has no further changes to trigger a retry.
          this.retryLater(mine);
        })
        .finally(() => {
          for (const k of mine) this.inflight.delete(k);
          this.pending -= mine.length;
          this.onPending?.(this.pending);
        });
      for (const k of mine) this.inflight.set(k, job);
      wait.push(job);
    }
    await Promise.all(wait);
  }

  private retries = 0;
  private retryTimer: number | null = null;

  private retryLater(keys: string[]) {
    if (this.retries >= 5 || !this.observer) return;
    const delay = 1500 * 2 ** this.retries++;
    for (const k of keys) this.queue.add(k);
    if (this.retryTimer) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.observer) void this.flush();
    }, delay);
  }

  private apply(key: string) {
    const targets = this.waiting.get(key);
    this.waiting.delete(key);
    if (!targets || !this.dict.has(key) || !this.observer) return;
    for (const tg of targets) {
      if ("node" in tg) {
        if (tg.node.isConnected) this.text(tg.node);
      } else if (tg.el.isConnected) this.attr(tg.el, tg.attr);
    }
  }

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      try {
        // Keep the most recent 5000 entries.
        const entries = [...this.dict].slice(-5000);
        localStorage.setItem(STORE(this.lang), JSON.stringify(Object.fromEntries(entries)));
      } catch {
        /* storage full: the server cache still has them */
      }
    }, 800);
  }
}
