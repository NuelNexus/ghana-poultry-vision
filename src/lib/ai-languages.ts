// Languages the farmer can pick for talking to Ama. Shared by the browser and the server.
//
// OpenAI's speech-to-text takes a language code for English and French only (it rejects
// "ha" for Hausa), and has no code for Twi, Ga or
// Ewe. For the rest we send a short prompt written in the language, which steers
// the transcriber to that language's spelling instead of guessing English.

export type SpeechLang = "auto" | "en" | "tw" | "ga" | "ee" | "ha" | "fr";

export const SPEECH_LANGS: { id: SpeechLang; name: string; native: string }[] = [
  { id: "auto", name: "Auto-detect", native: "Auto" },
  { id: "en", name: "English", native: "English" },
  { id: "tw", name: "Twi", native: "Twi (Akan)" },
  { id: "ga", name: "Ga", native: "Gã" },
  { id: "ee", name: "Ewe", native: "Eʋegbe" },
  { id: "ha", name: "Hausa", native: "Hausa" },
  { id: "fr", name: "French", native: "Français" },
];

/**
 * GhanaNLP Khaya codes for the languages it handles better than OpenAI: speech
 * recognition (asr), translation to and from English (mt) and voices (tts).
 * Khaya has no Hausa translation, so for Hausa Ama writes the reply herself.
 */
export const KHAYA_CODES: Partial<Record<SpeechLang, { asr: string; tts: string; mt?: string }>> = {
  tw: { asr: "twi", tts: "twi", mt: "tw" },
  ga: { asr: "gaa", tts: "gaa", mt: "gaa" },
  ee: { asr: "ewe", tts: "ewe", mt: "ee" },
  ha: { asr: "hau", tts: "hau" },
};

/** ISO-639-1 code the transcription API accepts, when it supports the language. */
export const STT_ISO: Partial<Record<SpeechLang, string>> = { en: "en", fr: "fr" };

/**
 * Transcription prompt: a short sample sentence in the language, so the model
 * writes it in that language and spelling. Whole sentences, never word lists:
 * the model repeats lists back when it hears silence.
 */
export const STT_PROMPT: Record<SpeechLang, string> = {
  auto:
    "A Ghanaian poultry farmer speaks, usually in English or Twi (Akan), sometimes another language. " +
    "Write what is said in the language spoken. Write Twi in Twi spelling with ɛ and ɔ.",
  en: "A poultry farmer in Ghana asks about the temperature, humidity, ammonia, the fan and the birds.",
  tw: "Twi kasa. Me nkokɔ no ho yɛ hyew, ɛdeɛn na menyɛ?",
  ga: "Ga wiemɔ. Mi wuoi lɛ yɛ he hiɛ, mɛni esa akɛ mafee?",
  ee: "Eʋegbe. Nye koklowo le dzo xɔm, nukae wòle be mawɔ?",
  ha: "Hausa. Kajina suna jin zafi, me zan yi?",
  fr: "Un éleveur de volailles au Ghana parle de température, d'humidité et du ventilateur.",
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * True when a transcript is the hint prompt read back (what the transcriber
 * returns for silence or noise). A farmer saying one short phrase that also
 * appears in the prompt is not an echo: only long copies of the prompt count.
 */
export function isPromptEcho(text: string, lang: SpeechLang) {
  const t = normalize(text);
  if (!t) return true;
  return [STT_PROMPT[lang], STT_PROMPT.auto].map(normalize).some(
    (p) =>
      (p.includes(t) && t.length >= p.length * 0.6) ||
      // Sometimes the whole prompt comes back wrapped, e.g. "context: ### <prompt> ###".
      t.includes(p),
  );
}

// Language detection -----------------------------------------------------------
// Ama picks her tools by language: Twi goes to the Ghanaian stack (stable-twi-tts
// voice, Khaya, DistilABENA), everything else to the GPT models. Detection is a
// quick word check, so it runs on every message and voice turn at no cost.

// Common Twi words, with and without the special letters (people often type "ye" for "yɛ").
const TWI_WORDS = new Set(
  (
    "akwaaba ɛte ete sɛn sen yɛ ye ɛyɛ eye wo wɔ mepɛ mepe wopɛ wope ɛdeɛn edeen deɛn deen adɛn aden " +
    "adɛ nkokɔ nkoko akokɔ akoko nsuo nsu hyew ɔhyew ohyew aduane aduan aane daabi meda medaase ase " +
    "mepa kyɛw kyew ɛho eho ho sɛ nti ɛnti enti firi fi nyinaa paa kakra bɛyɛ beye menyɛ menye menim " +
    "mente nte kɔ ko bra mframa nnipa ɔkwan okwan me na no mmoa mo ɛnnɛ nnɛ ɛnora kyerɛ kyere boa " +
    "menkɔ wobɛ ɛwɔ ewo hwɛ hwe hwehwɛ nkurofoɔ ɔyare oyare yare dɔɔso bebree pii ɛsɛ ese ɛhe ehe " +
    "ɛberɛ bere sɛnea senea adwuma ofie fie ɛfie efie wɔn won yɛn yen mmɔfra"
  ).split(" "),
);
// Words that are also everyday English, so they only count alongside real Twi words.
const TWI_WEAK = new Set([
  "me",
  "no",
  "na",
  "ho",
  "ase",
  "fi",
  "ko",
  "mo",
  "ye",
  "won",
  "sen",
  "boa",
]);
// Ewe and Ga share Twi's ɛ and ɔ; a few very common words tell them apart.
const EWE_WORDS = new Set([
  "nye",
  "le",
  "dzo",
  "nukae",
  "wòle",
  "be",
  "koklo",
  "koklowo",
  "akpe",
  "woezɔ",
  "mawɔ",
  "ŋdi",
]);
const GA_WORDS = new Set([
  "lɛ",
  "le",
  "mi",
  "ni",
  "akɛ",
  "ake",
  "kɛ",
  "ke",
  "nɔ",
  "ji",
  "mɛni",
  "meni",
  "oyiwaladɔŋŋ",
]);

/** "tw" when the text is Twi, otherwise "auto" (GPT handles English and every other language). */
export function detectLang(text: string): SpeechLang {
  const t = text.normalize("NFC").toLowerCase();
  if (/[ɖʋƒɣ]|[àèìòù]/.test(t)) return "auto"; // Ewe letters and tone marks
  const words = t.match(/[\p{L}']+/gu) ?? [];
  if (!words.length) return "auto";
  const strong = words.filter((w) => TWI_WORDS.has(w) && !TWI_WEAK.has(w)).length;
  const weak = words.filter((w) => TWI_WEAK.has(w)).length;
  const ga = words.filter((w) => GA_WORDS.has(w)).length;
  const ewe = words.filter((w) => EWE_WORDS.has(w)).length;
  if (Math.max(ga, ewe) >= 2 && Math.max(ga, ewe) >= strong) return "auto";
  // ɛ and ɔ never appear in English; with Ewe and Ga ruled out above, they mean Twi
  // (even when the transcriber misheard the words themselves).
  if (/[ɛɔ]/.test(t)) return "tw";
  if (strong >= 1 && words.length <= 2) return "tw"; // "Akwaaba", "Medaase"
  if (strong >= 2 && (strong + weak) / words.length >= 0.3) return "tw";
  return "auto";
}

export const langName = (id: SpeechLang) =>
  SPEECH_LANGS.find((l) => l.id === id)?.name ?? "English";
