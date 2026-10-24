import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Hand, Loader2, Mic, MoreHorizontal, Square, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useLanguage } from "@/components/LanguageProvider";
import { dictate, explainPage, speakText, voiceCommand } from "@/lib/api/i18n.functions";
import { listAlerts } from "@/lib/api/farm.functions";
import { Recorder, blobToBase64, micErrorMessage } from "@/lib/ai-audio";
import { SpeechPlayer, cachedChunk, stopAllSpeech, type FetchChunk } from "@/lib/speech-client";
import type { SiteLang } from "@/lib/site-lang";

// Help for farmers who can't read, or can't read English, on every page:
//
//   Speak        tap and say what you want in your language ("show me the alerts",
//                "is House A too hot?"). Ama opens the page or answers out loud.
//   Explain      Ama reads the screen and says, in your language, what it shows.
//   Tap to hear  while on, tapping any text reads it aloud. Tapping a button reads
//                its name first; tap it again to press it.
//   Mic on text boxes: speak instead of typing (names, notes, search...).
//   Spoken alerts (optional): new farm alerts are read out as they arrive.
//
// Everything is spoken in the site language: the female Twi voice for Twi, OpenAI's
// voice (or Khaya, with a key) for the others.

type Phase = "idle" | "listening" | "thinking" | "speaking";
type Bubble = { you?: string; ama: string; error?: boolean } | null;

const INTERACTIVE =
  "button, a[href], [role='button'], [role='tab'], [role='menuitem'], [role='switch'], [role='checkbox'], [role='radio'], [role='option'], summary, select, input[type='checkbox'], input[type='radio'], input[type='submit'], label";
const TYPING = "input, textarea, [contenteditable='true']";

export function useSiteSpeech() {
  const { lang } = useLanguage();
  const player = useRef<SpeechPlayer | null>(null);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    const p = new SpeechPlayer();
    p.onChange = (id) => setSpeaking(id !== null);
    player.current = p;
    return () => p.dispose();
  }, []);
  const fetchFor = useCallback(
    (l: SiteLang): FetchChunk =>
      (text, slowTwi) =>
        cachedChunk(`${l}\u0000${text}`, () => speakText({ data: { text, lang: l, slowTwi } })),
    [],
  );
  const say = useCallback(
    (text: string, id = "say") =>
      player.current?.speak(id, text, fetchFor(lang), { twi: lang === "tw" }) ?? Promise.resolve(),
    [lang, fetchFor],
  );
  const stop = useCallback(() => player.current?.stop(), []);
  const unlock = useCallback(() => player.current?.unlock(), []);
  return { say, stop, unlock, speaking };
}

/** Visible text of the main part of the page, for "Explain" and spoken commands. */
function screenText(max = 8000) {
  const root =
    document.querySelector("main") ??
    document.querySelector(".contact-us") ??
    document.querySelector("#root") ??
    document.body;
  const text = (root as HTMLElement).innerText ?? "";
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, max);
}

function labelOf(el: Element) {
  const h = el as HTMLElement;
  const own =
    h.getAttribute("aria-label") ||
    (h instanceof HTMLInputElement || h instanceof HTMLTextAreaElement
      ? h.labels?.[0]?.innerText || h.placeholder
      : "") ||
    // textContent, not innerText: innerText comes back in CSS capitals ("ALERTS"),
    // which neither reads well nor matches the site text the server knows.
    h.textContent ||
    h.getAttribute("title") ||
    "";
  return own.replace(/\s+/g, " ").trim().slice(0, 400);
}

export function AccessDock() {
  const { lang, prefs, setPrefs, pending, translate } = useLanguage();
  const { user } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const navigate = useNavigate();
  const { say, stop, unlock, speaking } = useSiteSpeech();
  const [phase, setPhase] = useState<Phase>("idle");
  const [bubble, setBubble] = useState<Bubble>(null);
  const rec = useRef<Recorder | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // The dock is one small pill (Speak + ⋯) so it covers as little of the page as
  // possible; ⋯ opens Explain and Tap to hear above it.
  const [more, setMore] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const away = (e: PointerEvent) => {
      if (!dockRef.current?.contains(e.target as Node)) setMore(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMore(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [more]);

  useEffect(() => {
    if (phase === "speaking" && !speaking) setPhase("idle");
  }, [speaking, phase]);

  const talk = useCallback(
    async (text: string, you?: string) => {
      setBubble({ ama: text, you });
      setPhase("speaking");
      try {
        await say(text);
      } catch {
        /* text stays on screen */
      }
      setPhase((p) => (p === "speaking" ? "idle" : p));
    },
    [say],
  );

  // Speak -------------------------------------------------------------------------
  const finishListening = useCallback(async () => {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    setPhase("thinking");
    try {
      const heard = r.heardSomething;
      const blob = await r.stop();
      if (!heard || !blob || blob.size < 1200) {
        setBubble({ ama: "I didn’t hear anything. Tap the microphone and speak.", error: true });
        setPhase("idle");
        return;
      }
      const { text: said } = await dictate({
        data: { audio: await blobToBase64(blob), mimeType: blob.type, lang },
      });
      if (!said.trim()) {
        setBubble({ ama: "I didn’t catch that. Tap the microphone and try again.", error: true });
        setPhase("idle");
        return;
      }
      setBubble({ you: said, ama: "…" });
      const res = await voiceCommand({
        data: {
          lang,
          said,
          path: path + (search ? `?${search.replace(/^\?/, "")}` : ""),
          screen: screenText(3000),
        },
      });
      if (res.go) {
        const [to, q] = res.go.split("?");
        void navigate({
          to,
          search: q ? Object.fromEntries(new URLSearchParams(q)) : undefined,
        } as never);
      }
      await talk(res.say, said);
    } catch (err) {
      setBubble({ ama: err instanceof Error ? err.message : String(err), error: true });
      setPhase("idle");
    }
  }, [lang, path, search, navigate, talk]);

  const onSpeak = async () => {
    unlock();
    if (phase === "speaking") {
      stop();
      setPhase("idle");
      return;
    }
    if (phase === "listening") return void finishListening();
    if (phase === "thinking") return;
    stopAllSpeech();
    const r = new Recorder();
    try {
      await r.start();
      rec.current = r;
      r.onSilence = () => void finishListening();
      setBubble(null);
      setPhase("listening");
    } catch (err) {
      setBubble({ ama: micErrorMessage(err), error: true });
    }
  };
  useEffect(() => () => rec.current?.cancel(), []);

  // Explain -----------------------------------------------------------------------
  const onExplain = async () => {
    unlock();
    if (phase === "speaking") stop();
    setPhase("thinking");
    setBubble({ ama: "…" });
    try {
      const { text } = await explainPage({
        data: { lang, title: document.title, text: screenText() },
      });
      await talk(text);
    } catch (err) {
      setBubble({ ama: err instanceof Error ? err.message : String(err), error: true });
      setPhase("idle");
    }
  };

  // Tap to hear -----------------------------------------------------------------
  const lastTap = useRef<{ el: Element; at: number } | null>(null);
  useEffect(() => {
    if (!prefs.tapToHear) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || t.closest(".pg-dock, .pg-dock-bubble, .pg-dictate")) return;
      const typing = t.closest(TYPING);
      const inter = t.closest(INTERACTIVE);
      const el =
        typing ?? inter ?? t.closest("p, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd, span, div");
      if (!el) return;
      const text = labelOf(el);
      if (!text) return;
      document
        .querySelectorAll(".pg-hear-target")
        .forEach((x) => x.classList.remove("pg-hear-target"));
      el.classList.add("pg-hear-target");
      window.setTimeout(() => el.classList.remove("pg-hear-target"), 2500);
      if (inter && !typing) {
        const prev = lastTap.current;
        const second = prev && prev.el === inter && Date.now() - prev.at < 6000;
        if (!second) {
          // First tap on a button: say what it does; the second tap presses it.
          e.preventDefault();
          e.stopPropagation();
          lastTap.current = { el: inter, at: Date.now() };
          void say(text, "tap").catch(() => {});
          return;
        }
        lastTap.current = null;
        return;
      }
      lastTap.current = null;
      void say(text, "tap").catch(() => {});
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [prefs.tapToHear, say]);

  // Spoken alerts ------------------------------------------------------------------
  const inApp = path.startsWith("/app");
  const alerts = useQuery({
    queryKey: ["alerts-all"],
    queryFn: () => listAlerts(),
    refetchInterval: 30_000,
    enabled: Boolean(user && inApp && prefs.speakAlerts),
  });
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!prefs.speakAlerts) {
      seen.current = null;
      return;
    }
    const list = alerts.data;
    if (!list) return;
    if (!seen.current) {
      // Only alerts that arrive from now on; the backlog is on the Alerts page.
      seen.current = new Set(list.map((a) => a.id));
      return;
    }
    const fresh = list.filter((a) => !a.resolved && !seen.current!.has(a.id));
    fresh.forEach((a) => seen.current!.add(a.id));
    const loud = fresh.filter((a) => a.severity === "critical" || a.severity === "warning");
    if (!loud.length) return;
    void (async () => {
      const lines = await translate(["New farm alert:", ...loud.slice(0, 3).map((a) => a.message)]);
      void talk(lines.join(" "));
    })();
  }, [alerts.data, prefs.speakAlerts, translate, talk]);

  // Phones block sound until the first tap anywhere; unlock on it.
  useEffect(() => {
    const once = () => unlock();
    document.addEventListener("pointerdown", once, { once: true, capture: true });
    return () => document.removeEventListener("pointerdown", once, { capture: true });
  }, [unlock]);

  // Ama's own page has her chat and voice call; the dock would sit on top of them.
  const showDock = prefs.dock && !path.startsWith("/app/ai");
  // Leave room under the page so the dock never covers its last buttons.
  useEffect(() => {
    document.documentElement.classList.toggle("pg-has-dock", mounted && showDock);
    return () => document.documentElement.classList.remove("pg-has-dock");
  }, [mounted, showDock]);

  if (!mounted) return null;

  return createPortal(
    <>
      {prefs.dictation && <DictationMic />}
      {pending > 0 && (
        <div className="pg-translating" role="status" translate="no">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          <span>…</span>
        </div>
      )}
      {showDock && bubble && (
        <div className="pg-dock-bubble" role="status" aria-live="polite">
          <button
            type="button"
            className="pg-dock-x"
            aria-label="Close"
            onClick={() => {
              stop();
              setBubble(null);
              setPhase("idle");
            }}
          >
            <X aria-hidden />
          </button>
          {bubble.you && (
            <p className="pg-dock-you" translate="no">
              “{bubble.you}”
            </p>
          )}
          <p
            className={bubble.error ? "pg-dock-err" : undefined}
            translate={bubble.error ? undefined : "no"}
          >
            {bubble.ama}
          </p>
        </div>
      )}
      {showDock && (
        <div className="pg-dock" ref={dockRef} role="toolbar" aria-label="Voice help">
          {more && (
            <div className="pg-dock-menu" id="pg-dock-menu">
              <button
                type="button"
                className="pg-dock-btn"
                onClick={() => {
                  setMore(false);
                  void onExplain();
                }}
                disabled={phase === "thinking" || phase === "listening"}
              >
                <BookOpen aria-hidden />
                <span>Explain this page</span>
              </button>
              <button
                type="button"
                className="pg-dock-btn"
                aria-pressed={prefs.tapToHear}
                onClick={() => {
                  unlock();
                  const on = !prefs.tapToHear;
                  setPrefs({ tapToHear: on });
                  void translate([
                    on ? "Tap to hear is on. Tap anything to hear it." : "Tap to hear is off.",
                  ])
                    .then(([msg]) => say(msg, "tap"))
                    .catch(() => {});
                }}
              >
                <Hand aria-hidden />
                <span>Tap to hear</span>
                <span className="pg-dock-state">{prefs.tapToHear ? "On" : "Off"}</span>
              </button>
            </div>
          )}
          <div className="pg-dock-row">
            <button
              type="button"
              className="pg-dock-btn is-main"
              data-phase={phase}
              onClick={() => void onSpeak()}
              aria-label={
                phase === "listening" ? "Stop listening" : phase === "speaking" ? "Stop" : "Speak"
              }
            >
              {phase === "thinking" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : phase === "speaking" ? (
                <Square aria-hidden />
              ) : (
                <Mic aria-hidden />
              )}
              <span>
                {phase === "listening" ? "Listening" : phase === "speaking" ? "Stop" : "Speak"}
              </span>
            </button>
            <button
              type="button"
              className="pg-dock-more"
              aria-expanded={more}
              aria-controls="pg-dock-menu"
              aria-label={more ? "Close help menu" : "More help: Explain, Tap to hear"}
              data-tap={prefs.tapToHear || undefined}
              onClick={() => setMore((v) => !v)}
            >
              {more ? <X aria-hidden /> : <MoreHorizontal aria-hidden />}
            </button>
          </div>
        </div>
      )}
      <style>{DOCK_CSS}</style>
    </>,
    document.body,
  );
}

// Mic on text boxes ------------------------------------------------------------------

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function asEmail(s: string) {
  return s
    .toLowerCase()
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+/g, "")
    .replace(/[.。]+$/, "");
}

function DictationMic() {
  const { lang } = useLanguage();
  const [target, setTarget] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<Recorder | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
      if (el.readOnly || el.disabled || el.closest("[data-no-dictate]")) return;
      if (
        el instanceof HTMLInputElement &&
        !["text", "search", "email", "tel", "url", ""].includes(el.type)
      )
        return;
      setErr(null);
      setTarget(el);
    };
    const onBlur = () => {
      window.setTimeout(() => {
        if (stateRef.current !== "idle") return;
        const a = document.activeElement;
        if (!(a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement)) setTarget(null);
      }, 150);
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);

  useEffect(() => {
    if (!target) return setBox(null);
    const place = () => setBox(target.isConnected ? target.getBoundingClientRect() : null);
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    const t = window.setInterval(place, 500);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.clearInterval(t);
    };
  }, [target]);

  const finish = useCallback(async () => {
    const r = rec.current;
    rec.current = null;
    const el = target;
    if (!r || !el) return;
    setState("busy");
    try {
      const heard = r.heardSomething;
      const blob = await r.stop();
      if (!heard || !blob || blob.size < 1200) {
        setErr("I didn’t hear anything.");
        return;
      }
      const { text } = await dictate({
        data: { audio: await blobToBase64(blob), mimeType: blob.type, lang },
      });
      const said = text.trim();
      if (!said) {
        setErr("I didn’t catch that. Try again.");
        return;
      }
      const isEmail = el instanceof HTMLInputElement && el.type === "email";
      const add = isEmail ? asEmail(said) : said;
      const cur = el.value;
      setNativeValue(el, isEmail || !cur.trim() ? add : `${cur.replace(/\s+$/, "")} ${add}`);
      el.focus();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setState("idle");
    }
  }, [target, lang]);

  const toggle = async () => {
    if (state === "busy") return;
    if (state === "rec") return void finish();
    setErr(null);
    stopAllSpeech();
    const r = new Recorder();
    try {
      await r.start();
      rec.current = r;
      r.onSilence = () => void finish();
      setState("rec");
    } catch (e) {
      setErr(micErrorMessage(e));
    }
  };

  if (!target || !box || box.width < 60) return null;
  const size = Math.min(36, Math.max(28, box.height - 8));
  return (
    <div
      className="pg-dictate"
      style={{
        top: box.top + (box.height - size) / 2,
        left: box.right - size - 4,
        width: size,
        height: size,
      }}
    >
      <button
        type="button"
        data-state={state}
        aria-label={state === "rec" ? "Stop and write what I said" : "Speak instead of typing"}
        title={state === "rec" ? "Stop" : "Speak instead of typing"}
        // Keep focus in the text box.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void toggle()}
      >
        {state === "busy" ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : state === "rec" ? (
          <Square aria-hidden />
        ) : (
          <Mic aria-hidden />
        )}
      </button>
      {err && (
        <p className="pg-dictate-err" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}

const DOCK_CSS = `
.pg-dock {
  position: fixed; right: max(12px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom));
  z-index: 60; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  font-family: var(--pg-font-sans, system-ui, sans-serif); pointer-events: none;
}
.pg-dock > * { pointer-events: auto; }
.pg-dock-row {
  display: flex; align-items: center; gap: 2px; padding: 3px;
  background: var(--pg-surface, #fffdf7); border: 1px solid var(--pg-line-strong, rgba(0,0,0,.18));
  border-radius: 999px; box-shadow: var(--pg-shadow-pop, 0 8px 24px rgba(0,0,0,.18));
}
.pg-dock-btn {
  display: flex; align-items: center; gap: 10px; border: 0; background: transparent; cursor: pointer;
  color: var(--pg-ink, #1d1c2b); font: 600 13px/16px var(--pg-font-sans, system-ui, sans-serif); text-align: left;
}
.pg-dock-btn svg { width: 18px; height: 18px; flex-shrink: 0; }
.pg-dock-btn:disabled { opacity: .5; cursor: default; }
.pg-dock-btn.is-main {
  height: 40px; padding: 0 14px 0 12px; gap: 6px; border-radius: 999px;
  background: var(--pg-brand, #c2410c); color: var(--pg-on-brand, #fff);
}
.pg-dock-btn.is-main:hover { filter: brightness(1.08); }
.pg-dock-btn.is-main[data-phase="listening"] { background: var(--pg-crit, #b91c1c); color: var(--pg-on-crit, #fff); animation: pg-dock-pulse 1.2s ease-in-out infinite; }
@keyframes pg-dock-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(185,28,28,.45); } 50% { box-shadow: 0 0 0 8px rgba(185,28,28,0); } }
.pg-dock-more {
  position: relative; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 999px;
  background: transparent; color: var(--pg-ink-2, #4b4a5c); cursor: pointer;
}
.pg-dock-more:hover { background: var(--pg-hover, rgba(0,0,0,.06)); }
.pg-dock-more svg { width: 18px; height: 18px; }
/* Tap to hear is on: a dot on ⋯ so it's visible while the menu is closed. */
.pg-dock-more[data-tap]::after { content: ""; position: absolute; top: 6px; right: 6px; width: 7px; height: 7px;
  border-radius: 999px; background: var(--pg-brand, #c2410c); box-shadow: 0 0 0 2px var(--pg-surface, #fff); }
.pg-dock-menu {
  display: flex; flex-direction: column; min-width: 190px; padding: 4px;
  background: var(--pg-surface, #fffdf7); border: 1px solid var(--pg-line-strong, rgba(0,0,0,.18));
  border-radius: 14px; box-shadow: var(--pg-shadow-pop, 0 8px 24px rgba(0,0,0,.18));
  animation: pg-dock-in .14s ease-out;
}
@keyframes pg-dock-in { from { opacity: 0; transform: translateY(4px); } }
.pg-dock-menu .pg-dock-btn { width: 100%; min-height: 40px; padding: 0 10px; border-radius: 10px; font-weight: 500; }
.pg-dock-menu .pg-dock-btn:hover { background: var(--pg-hover, rgba(0,0,0,.06)); }
.pg-dock-menu .pg-dock-btn[aria-pressed="true"] { color: var(--pg-brand, #b4471b); }
.pg-dock-state { margin-left: auto; font-size: 12px; font-weight: 500; color: var(--pg-ink-3, #6b6a7c); }
.pg-dock-btn[aria-pressed="true"] .pg-dock-state { color: var(--pg-brand, #b4471b); }
.pg-dock-bubble {
  position: fixed; right: max(12px, env(safe-area-inset-right)); bottom: calc(max(12px, env(safe-area-inset-bottom)) + 56px);
  z-index: 60; width: min(340px, calc(100vw - 24px)); max-height: 50vh; overflow: auto;
  padding: 12px 34px 12px 14px; border-radius: 14px;
  background: var(--pg-surface, #fffdf7); color: var(--pg-ink, #1d1c2b);
  border: 1px solid var(--pg-line-strong, rgba(0,0,0,.18)); box-shadow: var(--pg-shadow-pop, 0 8px 24px rgba(0,0,0,.18));
  font: 15px/22px var(--pg-font-sans, system-ui, sans-serif);
}
.pg-dock-bubble p + p { margin-top: 6px; }
.pg-dock-you { color: var(--pg-ink-2, #4b4a5c); font-style: italic; }
.pg-dock-err { color: var(--pg-crit, #b91c1c); }
.pg-dock-x { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; display: grid; place-items: center;
  border: 0; border-radius: 8px; background: transparent; color: var(--pg-ink-2, #4b4a5c); cursor: pointer; }
.pg-dock-x:hover { background: var(--pg-hover, rgba(0,0,0,.06)); }
.pg-dock-x svg { width: 16px; height: 16px; }
.pg-translating { position: fixed; left: 50%; transform: translateX(-50%); top: 8px; z-index: 61;
  display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
  background: var(--pg-surface, #fffdf7); color: var(--pg-ink-2, #4b4a5c);
  border: 1px solid var(--pg-hairline, rgba(0,0,0,.12)); font: 12px/16px var(--pg-font-sans, system-ui, sans-serif); }
.pg-dictate { position: fixed; z-index: 62; }
.pg-dictate button { width: 100%; height: 100%; display: grid; place-items: center; border-radius: 999px;
  border: 1px solid var(--pg-line-strong, rgba(0,0,0,.2)); background: var(--pg-surface, #fff);
  color: var(--pg-brand, #c2410c); cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.pg-dictate button svg { width: 55%; height: 55%; }
.pg-dictate button[data-state="rec"] { background: var(--pg-crit, #b91c1c); color: #fff; animation: pg-dock-pulse 1.2s ease-in-out infinite; }
.pg-dictate-err { position: absolute; right: 0; top: calc(100% + 4px); white-space: nowrap; padding: 3px 8px; border-radius: 6px;
  background: var(--pg-crit, #b91c1c); color: #fff; font: 12px/16px var(--pg-font-sans, system-ui, sans-serif); }
html.pg-has-dock body { padding-bottom: 64px; }
.pg-hear-target { outline: 3px solid var(--pg-focus, #2563eb) !important; outline-offset: 2px; border-radius: 4px; }
@media (max-width: 640px) {
  .pg-dock-btn.is-main { height: 44px; }
  .pg-dock-more { width: 40px; height: 40px; }
}
@media (prefers-reduced-motion: reduce) { .pg-dock-btn.is-main[data-phase="listening"], .pg-dictate button[data-state="rec"], .pg-dock-menu { animation: none; } }
`;
