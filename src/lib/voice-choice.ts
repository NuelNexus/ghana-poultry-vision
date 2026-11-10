// Ama's voice, chosen per account in Profile > Language and voice.
//   nelvin  our own male Twi voice, fine-tuned from stable-twi-tts (the default)
//   male    stock stable-twi-tts twi-6
//   female  stock stable-twi-tts twi-1
// Engines without NELVIN (Khaya, OpenAI) use their male voice for it.
export const VOICES = ["nelvin", "male", "female"] as const;
export type VoiceChoice = (typeof VOICES)[number];
export const DEFAULT_VOICE: VoiceChoice = "nelvin";
export const voiceChoice = (v: unknown): VoiceChoice =>
  v === "female" ? "female" : v === "male" ? "male" : "nelvin";
