import process from "node:process";
import { query } from "./db.server";
import { chatCompletion, translateModel } from "./openai.server";
import { khayaEnabled, khayaTranslate } from "./khaya.server";
import { aiProvider, offlineTranslateMany, offlineTranslates } from "./local-ai.server";
import { siteLang, type SiteLang } from "./site-lang";

// Site text translation. The browser collects every English string on the page
// and asks for them here in batches. Each string is translated once per language
// and kept in ui_translations, so after the first visitor a page is instant.
//
// Engines, first that works:
//   Twi, Ewe, Hausa, French with TWI_OFFLINE_URL -> NLLB-200 on this computer (free, offline)
//   Twi, Ga, Ewe, Dagbani with KHAYA_API_KEY     -> GhanaNLP Khaya (trained on Ghanaian text)
//   everything else -> the chat model (local Ollama first, or OpenAI OPENAI_TRANSLATE_MODEL)
// Numbers arrive as placeholders (⟦0⟧, ⟦1⟧ ...), so "3 alerts" and "5 alerts" share one entry.

const GHANAIAN: SiteLang[] = ["tw", "ga", "ee", "dag"];
const MAX_LEN = 600;

// Translations already being fetched, so two tabs asking at once share one request.
const inflight = new Map<string, Promise<string | null>>();

const PLACEHOLDER = /⟦\d+⟧/g;
const sameSlots = (a: string, b: string) =>
  (a.match(PLACEHOLDER) ?? []).sort().join() === (b.match(PLACEHOLDER) ?? []).sort().join();

function systemPrompt(lang: SiteLang) {
  const l = siteLang(lang);
  return `You translate the interface of PoultryGrid, a poultry farm app used by farmers in Ghana,
from English into ${l.name} (${l.native}). Many readers have little schooling, so use the everyday
words a farmer in Ghana would say, short and clear, in correct ${l.name} spelling${
    lang === "tw"
      ? " (Asante Twi, with ɛ and ɔ)"
      : lang === "ee"
        ? " (with ɖ, ƒ, ɣ, ŋ, ɔ, ɛ, ʋ)"
        : ""
  }.
Meaning in this app: "birds" and "flock" are always the farmer's chickens (in Twi: nkokɔ, never
nnomaa); a "house" is a poultry house where the chickens live (in Twi: akokɔ dan); "Overview" is the
home screen summary; "alerts" are warnings about the farm.
Rules:
- Keep "PoultryGrid", "Ama" (the assistant's name), device ids, emails and units (°C, %, RPM) as they are.
- Keep every placeholder like ⟦0⟧ exactly once, where the number belongs in the sentence.
- Words with no common ${l.name} term (Raspberry Pi, ESP32-CAM, Wi-Fi, ammonia) may stay in English.
- Buttons and menu items stay short. Never add explanations, quotes or notes.
Return JSON {"t": [...]} with one translation per input string, in the same order.`;
}

async function viaOpenAI(lang: SiteLang, texts: string[]) {
  const raw = await chatCompletion(
    [
      { role: "system", content: systemPrompt(lang) },
      { role: "user", content: JSON.stringify(texts) },
    ],
    {
      model: translateModel(),
      maxTokens: 6000,
      timeoutMs: 90_000,
      jsonSchema: {
        name: "translations",
        schema: {
          type: "object",
          properties: { t: { type: "array", items: { type: "string" } } },
          required: ["t"],
          additionalProperties: false,
        },
      },
    },
  );
  const out = (JSON.parse(raw) as { t: string[] }).t;
  return texts.map((src, i) => {
    const t = out[i]?.trim();
    return t && sameSlots(src, t) ? t : null;
  });
}

async function viaKhaya(lang: SiteLang, texts: string[]) {
  return Promise.all(
    texts.map(async (src) => {
      const t = await khayaTranslate(src, "en", lang as never).catch(() => null);
      return t && sameSlots(src, t) ? t : null;
    }),
  );
}

async function viaOffline(lang: SiteLang, texts: string[]) {
  const got = await offlineTranslateMany(texts, "en", lang as never).catch((e) => {
    console.warn(`[translate] offline ${lang} failed:`, e instanceof Error ? e.message : e);
    return texts.map(() => "");
  });
  return texts.map((src, i) => (got[i] && sameSlots(src, got[i]) ? got[i] : null));
}

async function translateMissing(lang: SiteLang, texts: string[]) {
  let out: (string | null)[] = texts.map(() => null);
  const offline = offlineTranslates(lang as never);
  if (offline) out = await viaOffline(lang, texts);
  const todo = texts.map((t, i) => (out[i] ? null : t));
  if (khayaEnabled() && GHANAIAN.includes(lang) && todo.some(Boolean)) {
    const k = await viaKhaya(
      lang,
      todo.filter((t): t is string => t !== null),
    );
    let j = 0;
    out = out.map((t, i) => t ?? (todo[i] !== null ? k[j++] : null));
  }
  const left = texts.map((t, i) => (out[i] ? null : t)).filter((t): t is string => t !== null);
  if (left.length) {
    const got = new Map<string, string | null>();
    // Small batches in parallel: a page's first translation takes a few seconds, not a minute.
    const parts: string[][] = [];
    for (let i = 0; i < left.length; i += 12) parts.push(left.slice(i, i + 12));
    await Promise.all(
      parts.map(async (part) => {
        const res = await viaOpenAI(lang, part).catch((e) => {
          console.warn(`[translate] ${lang} batch failed:`, e instanceof Error ? e.message : e);
          return part.map(() => null);
        });
        part.forEach((t, k) => got.set(t, res[k]));
      }),
    );
    out = out.map((t, i) => t ?? got.get(texts[i]) ?? null);
  }
  const engine = offline
    ? "nllb-200"
    : khayaEnabled() && GHANAIAN.includes(lang)
      ? "khaya"
      : aiProvider() === "local"
        ? process.env.LOCAL_LLM_MODEL || "gemma3:4b"
        : translateModel();
  const rows = texts
    .map((src, i) => ({ src, t: out[i] }))
    .filter((r): r is { src: string; t: string } => Boolean(r.t));
  if (rows.length) {
    await query(
      `insert into ui_translations (lang, source, text, engine)
       select $1, s, t, $4 from unnest($2::text[], $3::text[]) as x(s, t)
       on conflict (lang, source) do nothing`,
      [lang, rows.map((r) => r.src), rows.map((r) => r.t), engine],
    ).catch(() => {});
  }
  return out;
}

/** English strings -> the language. Missing entries (engine failed) come back as null. */
export async function translateTexts(lang: SiteLang, texts: string[]) {
  const uniq = [...new Set(texts.map((t) => t.trim()).filter((t) => t && t.length <= MAX_LEN))];
  const result = new Map<string, string | null>();
  if (lang === "en" || !uniq.length) return result;

  const cached = await query<{ source: string; text: string }>(
    "select source, text from ui_translations where lang = $1 and source = any($2::text[])",
    [lang, uniq],
  );
  for (const r of cached) result.set(r.source, r.text);

  const missing = uniq.filter((t) => !result.has(t));
  const mine: string[] = [];
  const waits: Promise<void>[] = [];
  for (const t of missing) {
    const p = inflight.get(`${lang}\u0000${t}`);
    if (p) waits.push(p.then((v) => void result.set(t, v)));
    else mine.push(t);
  }
  if (mine.length) {
    const job = translateMissing(lang, mine);
    mine.forEach((t, i) => {
      const p = job.then((o) => o[i]).catch(() => null);
      inflight.set(`${lang}\u0000${t}`, p);
      waits.push(
        p.then((v) => {
          result.set(t, v);
          inflight.delete(`${lang}\u0000${t}`);
        }),
      );
    });
  }
  await Promise.all(waits);
  return result;
}

/** True when this text is site text we've translated (or its source), i.e. safe to speak for a visitor. */
export async function isKnownSiteText(text: string) {
  const t = text.trim();
  // Exact match first (indexed); then a sentence taken from a longer site text.
  const exact = await query(
    "select 1 from ui_translations where text = $1 or source = $1 limit 1",
    [t],
  ).catch(() => []);
  if (exact.length) return true;
  if (t.length < 8) return false;
  const part = await query(
    "select 1 from ui_translations where strpos(text, $1) > 0 or strpos(source, $1) > 0 limit 1",
    [t],
  ).catch(() => []);
  return part.length > 0;
}
