import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Compass, PlayCircle } from "lucide-react";
import { Button, Grid, PageHeader, SegmentedControl } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import { useTour, videoLangFor } from "@/components/onboarding-tour";
import { GUIDES, VIDEO_LANG_LABEL, guidePoster, guideVideo, type VideoLang } from "@/lib/guides";

export const Route = createFileRoute("/app/guides")({ component: Guides });

/** Video guides (rendered with HyperFrames from videos/) and the welcome tour. */
function Guides() {
  const { user } = useAuth();
  const { startTour } = useTour();
  const [lang, setLang] = useState<VideoLang>(videoLangFor(user?.language));
  const [playing, setPlaying] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        title="Guides"
        description="Short videos on how the site and the two PoultryGrid units work."
      >
        <SegmentedControl
          ariaLabel="Video language"
          value={lang}
          onChange={(l) => {
            setLang(l);
            setPlaying(null);
          }}
          options={(["en", "tw"] as const).map((l) => ({ value: l, label: VIDEO_LANG_LABEL[l] }))}
        />
        <Button icon={Compass} onClick={startTour}>
          Replay the welcome tour
        </Button>
      </PageHeader>

      <Grid cols={3}>
        {GUIDES.map((g, n) => (
          <article key={g.slug} className="pg-panel overflow-hidden">
            <div className="relative aspect-video bg-black">
              {playing === g.slug ? (
                <video
                  key={lang}
                  src={guideVideo(g.slug, lang)}
                  poster={guidePoster(g.slug, lang)}
                  controls
                  autoPlay
                  playsInline
                  className="size-full"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setPlaying(g.slug)}
                  className="group size-full"
                  aria-label={`Play: ${g.title}`}
                >
                  <img
                    src={guidePoster(g.slug, lang)}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                  <PlayCircle
                    aria-hidden
                    className="absolute right-4 bottom-4 size-12 text-white drop-shadow-lg transition-transform group-hover:scale-110"
                    strokeWidth={1.5}
                  />
                </button>
              )}
            </div>
            <div className="p-4">
              <div className="pg-t-caption pg-num">Guide {n + 1}</div>
              <h2 className="pg-t-h3 mt-0.5">{g.title}</h2>
              <p className="mt-1 text-[14px] leading-5 text-ink-2">{g.description}</p>
            </div>
          </article>
        ))}
      </Grid>
    </div>
  );
}
