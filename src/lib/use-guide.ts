import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { setMyVoice } from "@/lib/api/auth.functions";
import { clearSpeechCache } from "@/lib/speech-client";
import { GUIDES, guideIdFor, type GuideId } from "@/lib/guide";
import { voiceChoice, type VoiceChoice } from "@/lib/voice-choice";

/**
 * The account's guide (Ama or Kofi) and voice. Choosing a guide also switches
 * to that guide's voice: Ama -> female, Kofi -> NELVIN. Saved on the account.
 */
export function useGuide() {
  const { user, patchUser } = useAuth();
  const qc = useQueryClient();
  const voice = voiceChoice(user?.voice);
  const id = guideIdFor(voice);

  const save = useMutation({
    mutationFn: (v: VoiceChoice) => setMyVoice({ data: { voice: v } }),
    onMutate: (v) => {
      // Audio already fetched was spoken in the old voice.
      clearSpeechCache();
      qc.setQueryData<typeof user>(["me"], (u) => (u ? { ...u, voice: v } : u));
    },
    onSuccess: (r) => void patchUser({ voice: r.voice }),
    onError: () => {
      toast.error("Couldn’t save that. Try again.");
      void patchUser({});
    },
  });

  return {
    id,
    guide: GUIDES[id],
    voice,
    setVoice: (v: VoiceChoice) => save.mutate(v),
    choose: (g: GuideId) => {
      if (g !== id) save.mutate(GUIDES[g].voice);
    },
  };
}
