import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { setMyLanguage } from "@/lib/api/auth.functions";
import { translateUi } from "@/lib/api/i18n.functions";
import { DomTranslator } from "@/lib/dom-translator";
import {
  LANG_STORAGE_KEY,
  isSiteLang,
  siteLang,
  type SiteLang,
  type SiteLangInfo,
} from "@/lib/site-lang";

// The site language for everyone, signed in or not, plus the voice helpers'
// settings. Mounted once at the root, so the landing, sign-in and sign-up pages
// are translated too.

/** Voice and reading helpers (Profile > Language and voice). Saved per device. */
export interface VoicePrefs {
  /** Floating Speak / Explain / Tap-to-hear buttons. */
  dock: boolean;
  /** Tap anything to hear it read out; tap a button twice to press it. */
  tapToHear: boolean;
  /** Mic button on text boxes. */
  dictation: boolean;
  /** Say new farm alerts out loud. */
  speakAlerts: boolean;
}
const DEFAULT_PREFS: VoicePrefs = {
  dock: true,
  tapToHear: false,
  dictation: true,
  speakAlerts: false,
};
const PREFS_KEY = "pg-voice-prefs";

interface LangCtx {
  lang: SiteLang;
  info: SiteLangInfo;
  setLang: (l: SiteLang) => void;
  /** Translate strings now (e.g. a greeting before reading it aloud). English comes back unchanged. */
  translate: (texts: string[]) => Promise<string[]>;
  /** Strings still being translated on this page (for a small "Translating..." note). */
  pending: number;
  prefs: VoicePrefs;
  setPrefs: (patch: Partial<VoicePrefs>) => void;
}

const Ctx = createContext<LangCtx | null>(null);

export function useLanguage() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLanguage must be used inside <LanguageProvider>");
  return v;
}

function readStored(): SiteLang | null {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return isSiteLang(v) ? v : null;
  } catch {
    return null;
  }
}
function readPrefs(): VoicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<VoicePrefs>;
    return {
      dock: typeof raw.dock === "boolean" ? raw.dock : DEFAULT_PREFS.dock,
      tapToHear: typeof raw.tapToHear === "boolean" ? raw.tapToHear : DEFAULT_PREFS.tapToHear,
      dictation: typeof raw.dictation === "boolean" ? raw.dictation : DEFAULT_PREFS.dictation,
      speakAlerts:
        typeof raw.speakAlerts === "boolean" ? raw.speakAlerts : DEFAULT_PREFS.speakAlerts,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

const batch = (lang: SiteLang, texts: string[]) =>
  translateUi({ data: { lang, texts } }).then((r) => r.t);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  // Hydration-safe: English on the server and first paint, then the stored choice.
  const [lang, setLangState] = useState<SiteLang>("en");
  const [prefs, setPrefsState] = useState<VoicePrefs>(DEFAULT_PREFS);
  const [pending, setPending] = useState(0);
  const translator = useRef<DomTranslator | null>(null);

  useEffect(() => {
    const s = readStored();
    if (s) setLangState(s);
    setPrefsState(readPrefs());
  }, []);

  // Signed in: the account's language wins (it follows them to every device).
  const userLang = user?.language;
  useEffect(() => {
    if (!isSiteLang(userLang)) return;
    setLangState(userLang);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, userLang);
    } catch {
      /* ignore */
    }
  }, [userLang]);

  // Translate the page while a language other than English is chosen.
  useEffect(() => {
    document.documentElement.lang = siteLang(lang).tag;
    if (lang === "en") return;
    const t = new DomTranslator(lang, batch);
    t.onPending = setPending;
    translator.current = t;
    t.start(document.body);
    return () => {
      t.onPending = null;
      t.stop();
      if (translator.current === t) translator.current = null;
      setPending(0);
    };
  }, [lang]);

  const setLang = useCallback(
    (l: SiteLang) => {
      setLangState(l);
      try {
        localStorage.setItem(LANG_STORAGE_KEY, l);
      } catch {
        /* ignore */
      }
      if (user) {
        qc.setQueryData(["me"], (u: typeof user | null | undefined) =>
          u ? { ...u, language: l } : u,
        );
        void setMyLanguage({ data: { language: l } }).catch(() => {});
      }
    },
    [user, qc],
  );

  const setPrefs = useCallback((patch: Partial<VoicePrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const translate = useCallback(
    async (texts: string[]) => {
      if (lang === "en") return texts;
      const t = translator.current ?? new DomTranslator(lang, batch);
      return t.translate(texts).catch(() => texts);
    },
    [lang],
  );

  const value = useMemo<LangCtx>(
    () => ({ lang, info: siteLang(lang), setLang, translate, pending, prefs, setPrefs }),
    [lang, setLang, translate, pending, prefs, setPrefs],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
