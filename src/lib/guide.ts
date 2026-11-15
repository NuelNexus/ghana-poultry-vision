import { voiceChoice, type VoiceChoice } from "./voice-choice";

// The 3D guide on the AI page. Each guide has their own voice, so the account's
// saved voice also picks the guide (no separate setting to keep in sync):
//   Ama   female explorer, speaks with the female voice
//   Kofi  Ghanaian farmer in workwear, speaks with NELVIN (or the stock male voice)
export const GUIDES = {
  ama: { name: "Ama", voice: "female", she: "she", her: "her" },
  kofi: { name: "Kofi", voice: "nelvin", she: "he", her: "his" },
} as const satisfies Record<string, { name: string; voice: VoiceChoice; she: string; her: string }>;

export type GuideId = keyof typeof GUIDES;
export type Guide = (typeof GUIDES)[GuideId];

export const guideIdFor = (voice: unknown): GuideId =>
  voiceChoice(voice) === "female" ? "ama" : "kofi";
export const guideFor = (voice: unknown): Guide => GUIDES[guideIdFor(voice)];
