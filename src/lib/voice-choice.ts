// Ama's voice, chosen per account in Profile > Language and voice.
export const VOICES = ["male", "female"] as const;
export type VoiceChoice = (typeof VOICES)[number];
export const DEFAULT_VOICE: VoiceChoice = "male";
export const voiceChoice = (v: unknown): VoiceChoice => (v === "female" ? "female" : "male");
