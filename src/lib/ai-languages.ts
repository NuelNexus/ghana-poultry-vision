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

export const isSpeechLang = (v: unknown): v is SpeechLang => SPEECH_LANGS.some((l) => l.id === v);

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
export const usesKhaya = (lang: SpeechLang) => lang in KHAYA_CODES;

/** ISO-639-1 code the transcription API accepts, when it supports the language. */
export const STT_ISO: Partial<Record<SpeechLang, string>> = { en: "en", fr: "fr" };

/**
 * Transcription prompt: a short sample sentence in the language, so the model
 * writes it in that language and spelling. Whole sentences, never word lists:
 * the model repeats lists back when it hears silence.
 */
export const STT_PROMPT: Record<SpeechLang, string> = {
  auto:
    "A Ghanaian poultry farmer may speak English, Twi, Ga, Ewe or Hausa. " +
    "Write what is said in the language spoken, with that language's own letters such as ɛ, ɔ, ŋ, ɖ and ʋ.",
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

export const langName = (id: SpeechLang) =>
  SPEECH_LANGS.find((l) => l.id === id)?.name ?? "English";
