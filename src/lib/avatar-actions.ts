// Mixamo animations the voice assistant can play while she speaks.
// Files live in public/ai/anims/<id>.fbx. The `hint` text is given to the
// language model so it can pick a fitting action for each part of a reply.

export const AVATAR_ACTIONS = {
  talking: { file: "talking.fbx", hint: "neutral explaining, the default while speaking" },
  talking2: {
    file: "talking2.fbx",
    hint: "explaining with more hand gestures, giving steps or advice",
  },
  excited: { file: "excited.fbx", hint: "greetings, good news, flock is healthy, celebrating" },
  sad: { file: "sad.fbx", hint: "bad news, sympathy, losses or sick birds" },
  angry: {
    file: "angry.fbx",
    hint: "stern urgent warning about a critical or dangerous condition",
  },
  walking: { file: "walking.fbx", hint: "'let me check' / going over to look at something" },
  backflip: { file: "backflip.fbx", hint: "rare big celebration only, e.g. a perfect hatch rate" },
  idle: { file: "idle.fbx", hint: "a short calm pause between thoughts" },
} as const;

export type AvatarAction = keyof typeof AVATAR_ACTIONS;
export const AVATAR_ACTION_IDS = Object.keys(AVATAR_ACTIONS) as AvatarAction[];

export interface VoiceSegment {
  text: string;
  action: AvatarAction;
}
