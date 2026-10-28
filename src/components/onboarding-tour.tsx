import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { PlayCircle, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { completeOnboarding } from "@/lib/api/auth.functions";
import { TOUR, guideVideo, type VideoLang } from "@/lib/guides";
import { Button } from "@/components/ui-kit";

// First-login tour. A new account sees it once, right after signing up: it
// highlights each sidebar link (and the voice-help dock) with a short
// explanation. On phones the sidebar is folded away, so the cards show in the
// middle of the screen. The text is translated by the site translator like
// any page. Guides can replay it.

const TourCtx = createContext<{ startTour: () => void }>({ startTour: () => {} });
export const useTour = () => useContext(TourCtx);

/** Intro video language: Twi readers get the Twi version, everyone else English. */
export const videoLangFor = (language: string | undefined): VideoLang =>
  language === "tw" ? "tw" : "en";

export function TourProvider({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (user && !user.onboarded_at) setOpen(true);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(async () => {
    setOpen(false);
    if (user && !user.onboarded_at) {
      try {
        await completeOnboarding();
        await refresh();
      } catch {
        // Shows again next sign-in; nothing else depends on it.
      }
    }
  }, [user, refresh]);

  return (
    <TourCtx.Provider value={{ startTour: () => setOpen(true) }}>
      {children}
      {open && <Tour videoLang={videoLangFor(user?.language)} onDone={() => void finish()} />}
    </TourCtx.Provider>
  );
}

function findTarget(selector?: string) {
  if (!selector) return null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return r;
  }
  return null;
}

function Tour({ videoLang, onDone }: { videoLang: VideoLang; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [video, setVideo] = useState(false);
  const step = TOUR[i];
  const last = i === TOUR.length - 1;

  useLayoutEffect(() => {
    const update = () => setRect(findTarget(step.target));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step.target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (video) return;
      if (e.key === "Escape") onDone();
      else if (e.key === "ArrowRight" && !last) setI((n) => n + 1);
      else if (e.key === "ArrowLeft" && i > 0) setI((n) => n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, last, video, onDone]);

  // Card beside the highlight: right of a sidebar link, above anything low on the screen.
  const pad = 6;
  let card: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (rect) {
    const low = rect.top > window.innerHeight * 0.6;
    const roomRight = window.innerWidth - rect.right > 380;
    card = low
      ? {
          right: Math.max(16, window.innerWidth - rect.right),
          bottom: window.innerHeight - rect.top + 16,
        }
      : roomRight
        ? {
            left: rect.right + 16,
            top: Math.max(16, Math.min(rect.top - 16, window.innerHeight - 300)),
          }
        : { left: 16, right: 16, top: rect.bottom + 16, margin: "0 auto" };
  }

  return (
    <div
      className="fixed inset-0 z-[90]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pg-tour-title"
    >
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-lg transition-all duration-300"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55), 0 0 0 3px var(--pg-brand)",
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/55" />
      )}

      <div
        className="pg-panel absolute w-[min(360px,calc(100vw-32px))] p-5 shadow-2xl"
        style={card}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="pg-tour-title" className="pg-t-h3">
            {step.title}
          </h2>
          <button
            type="button"
            onClick={onDone}
            aria-label="Close the tour"
            className="pg-iconbtn -mt-1 -mr-2 shrink-0"
          >
            <X aria-hidden />
          </button>
        </div>
        <p className="mt-1.5 text-[14px] leading-5 text-ink-2">{step.body}</p>

        {i === 0 && (
          <Button icon={PlayCircle} className="mt-3 w-full" onClick={() => setVideo(true)}>
            Watch the intro video
          </Button>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="pg-t-caption pg-num">
            {i + 1} / {TOUR.length}
          </span>
          <div className="flex gap-2">
            {i > 0 ? (
              <Button variant="ghost" onClick={() => setI(i - 1)}>
                Back
              </Button>
            ) : (
              <Button variant="ghost" onClick={onDone}>
                Skip
              </Button>
            )}
            <Button variant="primary" onClick={() => (last ? onDone() : setI(i + 1))}>
              {last ? "Start farming" : i === 0 ? "Show me around" : "Next"}
            </Button>
          </div>
        </div>
      </div>

      {video && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setVideo(false)}
        >
          <button
            type="button"
            onClick={() => setVideo(false)}
            aria-label="Close the video"
            className="absolute top-4 right-4 text-white"
          >
            <X className="size-6" aria-hidden />
          </button>
          <video
            src={guideVideo("welcome", videoLang)}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
            onEnded={() => setVideo(false)}
          />
        </div>
      )}
    </div>
  );
}
