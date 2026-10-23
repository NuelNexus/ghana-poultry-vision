import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Volume2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { helloAudio } from "@/lib/api/i18n.functions";
import { SITE_LANGS, type SiteLang } from "@/lib/site-lang";
import { SpeechPlayer, cachedChunk } from "@/lib/speech-client";

// Big language tiles. Tapping one switches the whole site to it straight away and
// plays a greeting spoken in that language, so a farmer who can't read can find
// theirs by ear. Used at sign-up, on the sign-in page and in Profile.

export function LanguagePicker({
  variant = "tiles",
  onPick,
}: {
  variant?: "tiles" | "chips";
  onPick?: (l: SiteLang) => void;
}) {
  const { lang, setLang } = useLanguage();
  const player = useRef<SpeechPlayer | null>(null);
  const [loading, setLoading] = useState<SiteLang | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => {
    const p = new SpeechPlayer();
    p.onChange = setPlaying;
    player.current = p;
    return () => p.dispose();
  }, []);

  const pick = async (l: SiteLang) => {
    const p = player.current;
    p?.unlock();
    setLang(l);
    onPick?.(l);
    if (!p) return;
    setLoading(l);
    try {
      // The greeting is one short sentence: fetch it whole (it also caches).
      const r = await cachedChunk(`hello\u0000${l}`, () => helloAudio({ data: { lang: l } }));
      setLoading(null);
      await p.speak(`hello-${l}`, "x", () => Promise.resolve(r));
    } catch {
      /* no sound: the choice still applies */
    } finally {
      setLoading((x) => (x === l ? null : x));
    }
  };

  return (
    <div
      className={variant === "tiles" ? "pg-langs" : "pg-langs pg-langs--chips"}
      role="radiogroup"
      aria-label="Language"
    >
      {SITE_LANGS.map((l) => {
        const on = l.id === lang;
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={on}
            className="pg-lang"
            data-on={on || undefined}
            onClick={() => void pick(l.id)}
            translate="no"
          >
            <span className="pg-lang-native">{l.native}</span>
            {variant === "tiles" && l.native !== l.name && (
              <span className="pg-lang-name">{l.name}</span>
            )}
            <span className="pg-lang-icon" aria-hidden>
              {loading === l.id ? (
                <Loader2 className="animate-spin" />
              ) : playing === `hello-${l.id}` ? (
                <Volume2 />
              ) : on ? (
                <Check />
              ) : (
                <Volume2 className="opacity-50" />
              )}
            </span>
          </button>
        );
      })}
      <style>{PICKER_CSS}</style>
    </div>
  );
}

const PICKER_CSS = `
.pg-langs { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.pg-lang { position: relative; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px;
  min-height: 64px; padding: 10px 40px 10px 14px; text-align: left; cursor: pointer;
  border-radius: 12px; border: 2px solid var(--pg-line-strong, rgba(0,0,0,.25));
  background: var(--pg-surface, #fffdf7); color: var(--pg-ink, #2a293e); font: inherit; }
.pg-lang:hover { background: var(--pg-hover, rgba(0,0,0,.05)); }
.pg-lang[data-on] { border-color: var(--pg-brand, #c2410c); background: var(--pg-brand-tint, #ffe9de); }
.pg-lang-native { font-size: 17px; line-height: 22px; font-weight: 600; }
.pg-lang-name { font-size: 12px; line-height: 16px; opacity: .75; }
.pg-lang-icon { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); display: grid; color: var(--pg-brand, #c2410c); }
.pg-lang-icon svg { width: 20px; height: 20px; }
.pg-langs--chips { display: flex; flex-wrap: wrap; gap: 6px; }
.pg-langs--chips .pg-lang { min-height: 36px; padding: 4px 30px 4px 10px; border-width: 1px; border-radius: 999px; }
.pg-langs--chips .pg-lang-native { font-size: 13px; line-height: 18px; }
.pg-langs--chips .pg-lang-icon { right: 8px; }
.pg-langs--chips .pg-lang-icon svg { width: 15px; height: 15px; }
`;
