// The language the whole site is shown in. Picked at sign-up (or on the sign-in
// page), changeable in Profile > Language, and saved on the account. Shared by
// the browser and the server.
//
// English is the source text. Every other language is translated on the fly
// (src/lib/translate.server.ts) and cached, so each sentence is translated once.

import { detectLang, type SpeechLang } from "./ai-languages";

export type SiteLang = "en" | "tw" | "ga" | "ee" | "dag" | "ha" | "fr";

export interface SiteLangInfo {
  id: SiteLang;
  /** English name. */
  name: string;
  /** Name in the language itself (what the picker shows big). */
  native: string;
  /** Hint for the speech-to-text model (STT_PROMPT key). */
  speech: SpeechLang;
  /** BCP-47 tag for <html lang>. */
  tag: string;
}

export const SITE_LANGS: SiteLangInfo[] = [
  {
    id: "en",
    name: "English",
    native: "English",
    speech: "en",
    tag: "en",
  },
  {
    id: "tw",
    name: "Twi",
    native: "Twi (Akan)",
    speech: "tw",
    tag: "ak",
  },
  {
    id: "ga",
    name: "Ga",
    native: "Gã",
    speech: "ga",
    tag: "gaa",
  },
  {
    id: "ee",
    name: "Ewe",
    native: "Eʋegbe",
    speech: "ee",
    tag: "ee",
  },
  {
    id: "dag",
    name: "Dagbani",
    native: "Dagbanli",
    speech: "dag",
    tag: "dag",
  },
  {
    id: "ha",
    name: "Hausa",
    native: "Hausa",
    speech: "ha",
    tag: "ha",
  },
  {
    id: "fr",
    name: "French",
    native: "Français",
    speech: "fr",
    tag: "fr",
  },
];

/**
 * Greeting played when a farmer taps a language in the picker, so they can choose
 * by ear. Written in English and translated like the rest of the site.
 */
export const helloIn = (l: SiteLangInfo) => `Welcome. Tap here to use PoultryGrid in ${l.name}.`;

export const SITE_LANG_IDS = SITE_LANGS.map((l) => l.id) as [SiteLang, ...SiteLang[]];

export const siteLang = (id: string | null | undefined): SiteLangInfo =>
  SITE_LANGS.find((l) => l.id === id) ?? SITE_LANGS[0];

export const isSiteLang = (v: unknown): v is SiteLang =>
  typeof v === "string" && SITE_LANGS.some((l) => l.id === v);

/** Browser storage for the language chosen before signing in (and this device's last choice). */
export const LANG_STORAGE_KEY = "pg-lang";

/**
 * Which voice should read this text: Twi when it reads as Twi, the site language's
 * voice for text that isn't plainly English, otherwise the default (English) voice.
 */
export function speechLangFor(text: string, uiLang: SiteLang = "en"): SpeechLang {
  if (detectLang(text) === "tw") return "tw";
  if (uiLang === "en" || /\b(the|and|is|your|you|are|this)\b/i.test(text)) return "auto";
  return siteLang(uiLang).speech;
}
