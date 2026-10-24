import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PoultryGrid AI — Smart Poultry Farm Management for Ghana" },
      {
        name: "description",
        content:
          "Edge AI for poultry houses in Ghana. A Raspberry Pi watches temperature, humidity, gas and light, runs the ventilation fan, and streams an ESP32-CAM view to your phone.",
      },
      { property: "og:title", content: "PoultryGrid AI — Smart Poultry Farm Management" },
      {
        property: "og:description",
        content:
          "Raspberry Pi edge AI, automatic fan control, ESP32-CAM live view, roles for your team.",
      },
      { property: "og:url", content: "/" },
    ],
    links: [
      { rel: "canonical", href: "/" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@300;400&display=swap",
      },
    ],
  }),
  component: Landing,
});

const SCENES = [
  "DAY 0 · EGG",
  "DAY 21 · HATCH",
  "WEEK 1 · CHICK",
  "WEEK 8 · GROWER",
  "WEEK 20 · LAYER",
];
const FRAME_COUNT = 192;

function Landing() {
  useEffect(() => {
    const canvas = document.getElementById("seq-canvas") as HTMLCanvasElement | null;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Frame sequence of the egg-to-hen video (public/hatch). Scroll position picks the frame.
    const frames: (HTMLImageElement | null)[] = new Array(FRAME_COUNT).fill(null);
    let disposed = false;
    const frameSrc = (i: number) => `/hatch/f${String(i + 1).padStart(3, "0")}.webp`;
    const loadFrame = (i: number) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => {
          if (!disposed) frames[i] = img;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = frameSrc(i);
      });
    // first frame, then a coarse pass (every 8th) so scrubbing works early, then the rest
    const order: number[] = [];
    for (const step of [8, 4, 2, 1])
      for (let i = 0; i < FRAME_COUNT; i += step) if (!order.includes(i)) order.push(i);
    order.push(FRAME_COUNT - 1);
    (async () => {
      await loadFrame(0);
      let next = 1;
      const worker = async () => {
        while (!disposed && next < order.length) await loadFrame(order[next++]);
      };
      await Promise.all(Array.from({ length: 6 }, worker));
    })();
    const nearestLoaded = (i: number) => {
      for (let d = 0; d < FRAME_COUNT; d++) {
        if (frames[i - d]) return frames[i - d];
        if (frames[i + d]) return frames[i + d];
      }
      return null;
    };

    const sampler = document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true })!;
    let drawn: HTMLImageElement | null = null;
    let dirty = true;
    const draw = (img: HTMLImageElement) => {
      const cw = canvas.width,
        ch = canvas.height;
      const iw = img.naturalWidth,
        ih = img.naturalHeight;
      if (cw / ch >= 1) {
        // landscape: cover; the bird stays centred in the video
        const sc = Math.max(cw / iw, ch / ih);
        const w = iw * sc,
          h = ih * sc;
        ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      } else {
        // portrait: the whole bird in the top ~60%, fading into the floor colour below
        const h = Math.max(ch * 0.6, cw * (ih / iw)),
          w = iw * (h / ih);
        sampler.drawImage(img, iw * 0.4, ih * 0.94, iw * 0.2, ih * 0.06, 0, 0, 1, 1);
        const [r, g, b] = sampler.getImageData(0, 0, 1, 1).data;
        const floor = `rgb(${r},${g},${b})`;
        ctx.fillStyle = floor;
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, (cw - w) / 2, 0, w, h);
        const fade = ctx.createLinearGradient(0, h * 0.78, 0, h);
        fade.addColorStop(0, `rgba(${r},${g},${b},0)`);
        fade.addColorStop(1, floor);
        ctx.fillStyle = fade;
        ctx.fillRect(0, h * 0.78 - 1, cw, h * 0.22 + 2);
      }
      drawn = img;
      dirty = false;
    };

    let maxScroll = 1;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      dirty = true;
      maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    };
    resize();
    window.addEventListener("resize", resize);

    const N = 5;
    let tgt = 0,
      smooth = 0,
      velocity = 0;
    const ease = 0.1;

    const onScroll = () => {
      tgt = maxScroll > 0 ? window.scrollY / maxScroll : 0;
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const linePx = 16,
        pagePx = window.innerHeight * 0.9;
      const delta =
        e.deltaMode === 1 ? e.deltaY * linePx : e.deltaMode === 2 ? e.deltaY * pagePx : e.deltaY;
      velocity += delta;
      velocity = Math.max(-600, Math.min(600, velocity));
    };
    window.addEventListener("wheel", onWheel, { passive: false });

    const progFill = document.getElementById("prog-fill")!;
    const hudPct = document.getElementById("hud-pct")!;
    const sceneName = document.getElementById("scene-name")!;
    const dots = document.querySelectorAll(".scene-dot");

    const updateHUD = (s: number) => {
      const p = Math.round(s * 100);
      hudPct.textContent = String(p).padStart(3, "0") + "%";
      (progFill as HTMLElement).style.width = `${p}%`;
      const si = Math.min(N - 1, Math.floor(s * N));
      sceneName.textContent = SCENES[si];
      dots.forEach((d, i) => d.classList.toggle("active", i === si));
    };

    const revealEls = Array.from(
      document.querySelectorAll(".tag, h1, h2, .body-text, .stat-row, .cta, .h-line"),
    );
    revealEls.forEach((el) => {
      if ((el as HTMLElement).getBoundingClientRect().top < window.innerHeight * 0.92)
        el.classList.add("visible");
    });
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.1 },
    );
    revealEls.forEach((el) => io.observe(el));

    let anchorAnim: number | null = null;
    const stopAnchorAnim = () => {
      if (anchorAnim) {
        cancelAnimationFrame(anchorAnim);
        anchorAnim = null;
      }
    };
    const smoothScrollToY = (targetY: number, duration = 900) => {
      stopAnchorAnim();
      velocity = 0;
      const startY = window.scrollY;
      const diff = targetY - startY;
      const start = performance.now();
      const easeInOutCubic = (t: number) =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        const eOut = easeInOutCubic(p);
        window.scrollTo(0, startY + diff * eOut);
        if (p < 1) anchorAnim = requestAnimationFrame(tick);
        else anchorAnim = null;
      };
      anchorAnim = requestAnimationFrame(tick);
    };
    window.addEventListener("wheel", stopAnchorAnim, { passive: true });
    window.addEventListener("touchstart", stopAnchorAnim, { passive: true });
    window.addEventListener("mousedown", stopAnchorAnim, { passive: true });
    window.addEventListener("keydown", stopAnchorAnim);

    const anchors = document.querySelectorAll('a[href^="#s"]');
    const anchorHandlers: Array<{ a: Element; fn: (e: Event) => void }> = [];
    anchors.forEach((a) => {
      const fn = (e: Event) => {
        e.preventDefault();
        const id = (a as HTMLAnchorElement).getAttribute("href")!;
        const target = document.querySelector(id) as HTMLElement | null;
        if (!target) return;
        const y = Math.max(0, Math.min(target.offsetTop, maxScroll));
        smoothScrollToY(y);
      };
      a.addEventListener("click", fn);
      anchorHandlers.push({ a, fn });
    });

    let lastNow = performance.now();
    let rafId = 0;
    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame);
      const dt = Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;
      velocity *= Math.pow(0.85, dt * 60);
      if (Math.abs(velocity) > 0.2) window.scrollBy({ top: velocity * ease, behavior: "auto" });
      smooth += (tgt - smooth) * (1 - Math.exp(-dt * 8));
      updateHUD(smooth);
      const img = nearestLoaded(Math.round(smooth * (FRAME_COUNT - 1)));
      if (img && (img !== drawn || dirty)) draw(img);
    };
    rafId = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      stopAnchorAnim();
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("wheel", stopAnchorAnim);
      window.removeEventListener("touchstart", stopAnchorAnim);
      window.removeEventListener("mousedown", stopAnchorAnim);
      window.removeEventListener("keydown", stopAnchorAnim);
      anchorHandlers.forEach(({ a, fn }) => a.removeEventListener("click", fn));
      io.disconnect();
    };
  }, []);

  return (
    <div className="pg-landing">
      <canvas id="seq-canvas" aria-hidden="true" />
      <div id="seq-shade" aria-hidden="true" />

      <div id="hud">
        <div id="hud-pct">000%</div>
        <div className="progress-bar">
          <div className="progress-fill" id="prog-fill" />
        </div>
        <div className="scene-label" id="scene-name">
          {SCENES[0]}
        </div>
      </div>

      <div id="scene-strip">
        <div className="scene-dot active" />
        <div className="scene-dot" />
        <div className="scene-dot" />
        <div className="scene-dot" />
        <div className="scene-dot" />
      </div>

      <div id="scroll-container">
        <section id="s0">
          <div className="text-card">
            <div className="tag">PoultryGrid AI — Smart Farming Ghana</div>
            <h1>
              SMART
              <br />
              POULTRY
              <br />
              FOR GHANA
            </h1>
            <p className="body-text">
              A Raspberry Pi in the poultry house reads the climate, runs its own AI and drives the
              fan. Scroll to watch an egg grow into a laying hen, with PoultryGrid at every stage.
            </p>
            <div
              style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1.75rem" }}
            >
              <Link to="/login" search={{ mode: "signup" }} className="cta visible">
                Deploy account
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 6h10M6 1l5 5-5 5" />
                </svg>
              </Link>
              <Link to="/login" className="cta visible">
                Sign in
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 6h10M6 1l5 5-5 5" />
                </svg>
              </Link>
            </div>
          </div>
        </section>

        <section id="s1">
          <div className="text-card right">
            <div className="h-line" />
            <div className="tag">01 — Hatchery</div>
            <h2>
              INCUBATE
              <br />
              TRACK
            </h2>
            <p className="body-text">
              Log each batch and follow its 21-day cycle: lockdown on day 18, expected hatch date
              and the hatch rate you record at the end.
            </p>
            <div className="stat-row" style={{ justifyContent: "flex-end" }}>
              <div className="stat">
                <span className="stat-num">21</span>
                <span className="stat-label">Day cycle</span>
              </div>
              <div className="stat">
                <span className="stat-num">D18</span>
                <span className="stat-label">Lockdown</span>
              </div>
            </div>
          </div>
        </section>

        <section id="s2">
          <div className="text-card">
            <div className="h-line" />
            <div className="tag">02 — Sensing</div>
            <h2>
              LIVE
              <br />
              FARM PULSE
            </h2>
            <p className="body-text">
              A DHT22, an MQ-135 gas sensor and a light sensor report temperature, humidity, ammonia
              build-up and light every 30 seconds, with fan speed.
            </p>
            <div className="stat-row">
              <div className="stat">
                <span className="stat-num">30s</span>
                <span className="stat-label">Readings</span>
              </div>
              <div className="stat">
                <span className="stat-num">Pi</span>
                <span className="stat-label">Edge AI</span>
              </div>
              <div className="stat">
                <span className="stat-num">24/7</span>
                <span className="stat-label">Monitoring</span>
              </div>
            </div>
          </div>
        </section>

        <section id="s3">
          <div className="text-card right">
            <div className="h-line" />
            <div className="tag">03 — AI Health</div>
            <h2>
              PREDICT
              <br />
              PROTECT
            </h2>
            <p className="body-text">
              An on-device model flags heat stress, cold for the flock’s age, gas build-up and a
              stalled fan, with advice. An ESP32-CAM gives you eyes on the birds.
            </p>
            <a className="cta" href="#s4">
              Continue
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 6h10M6 1l5 5-5 5" />
              </svg>
            </a>
          </div>
        </section>

        <section id="s4">
          <div className="text-card">
            <div className="h-line" />
            <div className="tag">04 — Ventilation & Team</div>
            <h2>
              FAN
              <br />
              CONTROL
              <br />
              TEAM
            </h2>
            <p className="body-text">
              The Pi sets the fan from its own reading of the house, and you can override it from
              anywhere. Roles for owners, managers and workers.
            </p>
            <Link to="/login" search={{ mode: "signup" }} className="cta visible">
              Get started
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 6h10M6 1l5 5-5 5" />
              </svg>
            </Link>
          </div>
        </section>
      </div>

      <div id="credit">
        <a href="/login">PoultryGrid AI</a>
      </div>

      <style>{css}</style>
    </div>
  );
}

const css = `
.pg-landing {
  /* warm palette sampled from the hatching video's backdrop */
  --bg: #c9ab8a;
  --fg: #2b1d12;
  --muted: rgba(43, 29, 18, 0.55);
  --accent: #a3321e;           /* the hen's comb */
  --glass: rgba(246, 236, 222, 0.38);
  --glass-edge: rgba(255, 250, 242, 0.55);
  --font-display: "Bebas Neue", sans-serif;
  --font-mono: "DM Mono", monospace;
  --hairline: 0.0625rem;
  --ui-inset: 2rem;
  --nav-x: calc(var(--ui-inset) + 0.125rem);
  --reveal-offset: 0.625rem;
  --reveal-duration: 0.5s;
  --z-ui: 10;
  color-scheme: light;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-mono);
  min-height: 100vh;
}
.pg-landing *, .pg-landing *::before, .pg-landing *::after {
  box-sizing: border-box; margin: 0; padding: 0;
}
body:has(.pg-landing) { overflow-x: hidden; background: #c9ab8a; }

#seq-canvas {
  position: fixed; inset: 0; width: 100vw; height: 100vh;
  z-index: 0; pointer-events: none; background: var(--bg);
}
/* very light warm vignette that only softens the corners */
#seq-shade {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background: radial-gradient(ellipse 80% 75% at 50% 50%, transparent 55%, rgba(120, 86, 52, 0.22) 100%);
}

#hud {
  position: fixed; top: var(--ui-inset); right: var(--ui-inset); z-index: var(--z-ui);
  text-align: right; font-size: 0.65rem; letter-spacing: 0.15em;
  color: var(--muted); text-transform: uppercase; font-family: var(--font-mono);
}
#hud .progress-bar {
  width: 7.5rem; height: var(--hairline); background: var(--muted);
  margin-block-start: 0.5rem; margin-inline-start: auto; position: relative; overflow: hidden;
}
#hud .progress-fill {
  position: absolute; inset-block: 0; inset-inline-start: 0; width: 0%;
  background: var(--accent); transition: width 0.1s linear;
}
#hud .scene-label { font-size: 0.6rem; color: var(--accent); margin-block-start: 0.4rem; }

#scene-strip {
  position: fixed; left: var(--nav-x); top: 50%; translate: -50% -50%; z-index: var(--z-ui);
  display: flex; flex-direction: column; gap: 0.5rem;
}
.scene-dot {
  width: 0.25rem; height: 0.25rem; border-radius: 50%;
  background: var(--muted); transition: background 0.3s, scale 0.3s;
}
.scene-dot.active { background: var(--accent); scale: 1.8; }

#scroll-container { position: relative; z-index: 1; }
.pg-landing section {
  min-height: 100vh; display: flex; align-items: center; padding: 6rem 5rem;
}
.text-card {
  /* no box: text sits straight on the video, with a soft warm glow to stay readable */
  max-width: 25rem; padding: 0;
  text-shadow: 0 0 1.5rem rgba(232, 214, 190, 0.9), 0 0 0.4rem rgba(232, 214, 190, 0.7);
}
.text-card.right { margin-inline-start: auto; text-align: right; }
.text-card.center { margin-inline: auto; text-align: center; max-width: 28.75rem; }
.pg-landing .tag {
  font-size: 0.6rem; letter-spacing: 0.25em; text-transform: uppercase;
  color: var(--accent); margin-block-end: 1.1rem;
  opacity: 0; translate: 0 var(--reveal-offset);
  transition: opacity var(--reveal-duration) ease, translate var(--reveal-duration) ease;
}
.pg-landing .tag.visible { opacity: 1; translate: 0 0; }
.pg-landing h1, .pg-landing h2 {
  font-family: var(--font-display); font-weight: 400; letter-spacing: 0.03em; line-height: 0.92;
  opacity: 0; translate: 0 1.125rem;
  transition: opacity var(--reveal-duration) ease 0.08s, translate var(--reveal-duration) ease 0.08s;
  color: var(--fg);
}
.pg-landing h1.visible, .pg-landing h2.visible { opacity: 1; translate: 0 0; }
.pg-landing h1 { font-size: clamp(3rem, 8vw, 6.5rem); }
.pg-landing h2 { font-size: clamp(2.2rem, 6vw, 5rem); }
.body-text {
  font-size: 0.9rem; line-height: 1.75; color: rgba(43, 29, 18, 0.8);
  margin-block-start: 1.25rem; opacity: 0; translate: 0 var(--reveal-offset);
  transition: opacity var(--reveal-duration) ease 0.2s, translate var(--reveal-duration) ease 0.2s;
}
.body-text.visible { opacity: 1; translate: 0 0; }
.stat-row {
  display: flex; gap: 2.5rem; margin-block-start: 2rem; flex-wrap: wrap;
  opacity: 0; translate: 0 var(--reveal-offset);
  transition: opacity var(--reveal-duration) ease 0.3s, translate var(--reveal-duration) ease 0.3s;
}
.stat-row.visible { opacity: 1; translate: 0 0; }
.stat { display: flex; flex-direction: column; gap: 0.15rem; }
.stat-num { font-family: var(--font-display); font-size: 2.2rem; color: var(--accent); line-height: 1; }
.stat-label { font-size: 0.58rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); }
.h-line {
  width: 3.125rem; height: var(--hairline); background: var(--accent); margin-block-end: 1.2rem;
  opacity: 0; scale: 0 1; transform-origin: left;
  transition: opacity 0.4s ease, scale 0.4s ease;
}
.h-line.visible { opacity: 1; scale: 1 1; }
.text-card.right .h-line { transform-origin: right; margin-inline-start: auto; }
.text-card.center .h-line { transform-origin: center; margin-inline: auto; }
.pg-landing .cta {
  display: inline-flex; align-items: center; gap: 0.6rem; margin-block-start: 1.75rem;
  padding: 0.7rem 1.35rem; border: var(--hairline) solid var(--accent); border-radius: 999px;
  color: var(--accent); font-family: var(--font-mono); font-size: 0.62rem;
  letter-spacing: 0.18em; text-transform: uppercase; text-decoration: none; cursor: pointer;
  opacity: 0; translate: 0 var(--reveal-offset);
  transition: opacity var(--reveal-duration) ease 0.35s, translate var(--reveal-duration) ease 0.35s, background 0.2s, color 0.2s;
}
.pg-landing .cta.visible { opacity: 1; translate: 0 0; }
.pg-landing .cta:hover { background: var(--accent); color: #fff6ea; }
.pg-landing .cta svg { width: 0.6875rem; height: 0.6875rem; }

#credit {
  position: fixed; right: var(--ui-inset); top: 50%;
  transform: translateY(-50%) rotate(-90deg); transform-origin: right center;
  z-index: var(--z-ui); font-family: var(--font-mono); font-size: 0.65rem;
  letter-spacing: 0.15em; text-transform: uppercase;
}
#credit a { color: var(--muted); text-decoration: none; }

.pg-landing section { min-height: 130vh; }
.pg-landing section#s0 { min-height: 100vh; }

@media (max-width: 600px) {
  /* keep the bird visible above the card on phones */
  /* bottom room for the voice help pill, so it never covers the buttons */
  .pg-landing section { padding: 5rem 1.25rem 5.5rem; align-items: flex-end; }
  #hud { top: 1rem; right: 1rem; }
  #scene-strip, #credit { display: none; }
  .text-card { max-width: 100%; }
}
`;
