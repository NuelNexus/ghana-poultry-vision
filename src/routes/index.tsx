import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import Lenis from "lenis";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PoultryGrid AI — Smart Poultry Farm Management for Ghana" },
      {
        name: "description",
        content:
          "IoT + AI platform for poultry farms in Ghana. Real-time monitoring, hatchery control, disease prediction, ESP32 cameras, solar and biogas tracking.",
      },
      { property: "og:title", content: "PoultryGrid AI — Smart Poultry Farm Management" },
      { property: "og:description", content: "Run your poultry farms with IoT sensors, AI insights and renewable energy." },
      { property: "og:url", content: "/" },
    ],
    links: [
      { rel: "canonical", href: "/" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syncopate:wght@400;700&display=swap",
      },
    ],
  }),
  component: Landing,
});

const CARDS = [
  {
    id: "001",
    tag: "MONITOR",
    title: "REAL-TIME SENSORS",
    body: "Temperature, humidity, NH3, water and feed levels streamed live from ESP32 nodes across every house.",
    meta: "ESP32 · MQTT · 1Hz",
  },
  {
    id: "002",
    tag: "HATCH",
    title: "HATCHERY CONTROL",
    body: "Incubator setpoints, turning cycles, candling logs and hatch-date prediction with success scoring.",
    meta: "21-DAY CYCLE",
  },
  {
    id: "003",
    tag: "AI/HEALTH",
    title: "DISEASE PREDICTION",
    body: "Computer vision on flock behavior plus environmental anomaly detection to flag risk before outbreak.",
    meta: "GEMINI 2.5 · CV",
  },
  {
    id: "004",
    tag: "VISION",
    title: "ESP32-CAM FEEDS",
    body: "Multi-camera live MJPEG with snapshots, motion events and per-house fullscreen review.",
    meta: "MJPEG · 24/7",
  },
  {
    id: "005",
    tag: "POWER",
    title: "SOLAR + BIOGAS",
    body: "Track PV generation, battery state of charge and waste-to-energy conversion from manure digesters.",
    meta: "kWh · m³ CH4",
  },
  {
    id: "006",
    tag: "AUTOMATE",
    title: "FEED & VENT",
    body: "Schedule feeders, control ventilation and trigger cooling when thresholds are breached. Hands-off.",
    meta: "RULE ENGINE",
  },
  {
    id: "007",
    tag: "ALERT",
    title: "INSTANT NOTIFY",
    body: "Severity-routed alerts for offline devices, power loss, abnormal gas and predicted disease risk.",
    meta: "SMS · PUSH",
  },
  {
    id: "008",
    tag: "REPORT",
    title: "EXPORT ANALYTICS",
    body: "Daily, weekly and monthly performance reports. PDF and Excel exports for owners and auditors.",
    meta: "PDF · XLSX",
  },
  {
    id: "009",
    tag: "TEAM",
    title: "MULTI-FARM RBAC",
    body: "Operate many farms with admin, manager and worker roles. Permissions scoped per house and device.",
    meta: "RLS · ROLES",
  },
];

const BIG_TEXTS = ["POULTRY", "GRID", "GHANA", "SENSE", "PREDICT", "POWER", "FLOCK", "SCALE"];

type Item =
  | { el: HTMLDivElement; type: "card" | "text"; x: number; y: number; rot: number; baseZ: number }
  | { el: HTMLDivElement; type: "star"; x: number; y: number; baseZ: number; rot?: number };

function Landing() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const velRef = useRef<HTMLSpanElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current!;
    const world = worldRef.current!;

    const CONFIG = {
      starCount: 150,
      zGap: 800,
      camSpeed: 2.5,
    };

    // Build item list: alternate big-text and cards
    const sequence: Array<{ kind: "text" | "card"; data: number }> = [];
    let cardIdx = 0;
    let textIdx = 0;
    const totalSlots = CARDS.length + BIG_TEXTS.length;
    for (let i = 0; i < totalSlots; i++) {
      if (i % 3 === 0 && textIdx < BIG_TEXTS.length) {
        sequence.push({ kind: "text", data: textIdx++ });
      } else if (cardIdx < CARDS.length) {
        sequence.push({ kind: "card", data: cardIdx++ });
      } else if (textIdx < BIG_TEXTS.length) {
        sequence.push({ kind: "text", data: textIdx++ });
      }
    }
    const itemCount = sequence.length;
    const loopSize = itemCount * CONFIG.zGap;

    const items: Item[] = [];

    sequence.forEach((slot, i) => {
      const el = document.createElement("div");
      el.className = "pg-item";
      if (slot.kind === "text") {
        const txt = document.createElement("div");
        txt.className = "pg-big-text";
        txt.innerText = BIG_TEXTS[slot.data];
        el.appendChild(txt);
        items.push({ el, type: "text", x: 0, y: 0, rot: 0, baseZ: -i * CONFIG.zGap });
      } else {
        const c = CARDS[slot.data];
        const card = document.createElement("div");
        card.className = "pg-card";
        card.innerHTML = `
          <div class="pg-card-header">
            <span class="pg-card-id">ID-${c.id} // ${c.tag}</span>
            <div class="pg-card-dot"></div>
          </div>
          <h2>${c.title}</h2>
          <p class="pg-card-body">${c.body}</p>
          <div class="pg-card-footer">
            <span>${c.meta}</span>
            <span>NODE_${(Math.random() * 9999).toFixed(0).padStart(4, "0")}</span>
          </div>
          <div class="pg-card-num">${c.id}</div>
        `;
        el.appendChild(card);
        const angle = (i / itemCount) * Math.PI * 6;
        const x = Math.cos(angle) * (window.innerWidth * 0.28);
        const y = Math.sin(angle) * (window.innerHeight * 0.28);
        const rot = (Math.random() - 0.5) * 24;
        items.push({ el, type: "card", x, y, rot, baseZ: -i * CONFIG.zGap });
      }
      world.appendChild(el);
    });

    for (let i = 0; i < CONFIG.starCount; i++) {
      const el = document.createElement("div");
      el.className = "pg-star";
      world.appendChild(el);
      items.push({
        el,
        type: "star",
        x: (Math.random() - 0.5) * 3000,
        y: (Math.random() - 0.5) * 3000,
        baseZ: -Math.random() * loopSize,
      });
    }

    const state = { scroll: 0, velocity: 0, targetSpeed: 0, mouseX: 0, mouseY: 0 };

    const onMouse = (e: MouseEvent) => {
      state.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      state.mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMouse);

    const lenis = new Lenis({ lerp: 0.08, smoothWheel: true });
    lenis.on("scroll", ({ scroll, velocity }: { scroll: number; velocity: number }) => {
      state.scroll = scroll;
      state.targetSpeed = velocity;
    });

    let lastTime = 0;
    let rafId = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      const delta = time - lastTime;
      lastTime = time;
      if (fpsRef.current && time % 10 < 1) fpsRef.current.innerText = String(Math.round(1000 / delta));
      state.velocity += (state.targetSpeed - state.velocity) * 0.1;
      if (velRef.current) velRef.current.innerText = Math.abs(state.velocity).toFixed(2);
      if (coordRef.current) coordRef.current.innerText = state.scroll.toFixed(0);

      const tiltX = state.mouseY * 5 - state.velocity * 0.5;
      const tiltY = state.mouseX * 5;
      world.style.transform = `translate(-50%, -50%) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;

      const baseFov = 1000;
      const fov = baseFov - Math.min(Math.abs(state.velocity) * 10, 600);
      viewport.style.perspective = `${fov}px`;

      const cameraZ = state.scroll * CONFIG.camSpeed;
      const modC = loopSize;

      items.forEach((item) => {
        const relZ = item.baseZ + cameraZ;
        let vizZ = ((relZ % modC) + modC) % modC;
        if (vizZ > 500) vizZ -= modC;

        let alpha = 1;
        if (vizZ < -3000) alpha = 0;
        else if (vizZ < -2000) alpha = (vizZ + 3000) / 1000;
        if (vizZ > 100 && item.type !== "star") alpha = 1 - (vizZ - 100) / 400;
        if (alpha < 0) alpha = 0;
        item.el.style.opacity = String(alpha);

        if (alpha > 0) {
          let trans = `translate3d(${item.x}px, ${item.y}px, ${vizZ}px)`;
          if (item.type === "star") {
            const stretch = Math.max(1, Math.min(1 + Math.abs(state.velocity) * 0.1, 10));
            trans += ` scale3d(1, 1, ${stretch})`;
          } else if (item.type === "text") {
            trans += ` rotateZ(${item.rot}deg)`;
            if (Math.abs(state.velocity) > 1) {
              const offset = state.velocity * 2;
              item.el.style.textShadow = `${offset}px 0 #ff003c, ${-offset}px 0 #00f3ff`;
            } else {
              item.el.style.textShadow = "none";
            }
          } else {
            const t = time * 0.001;
            const float = Math.sin(t + item.x) * 8;
            trans += ` rotateZ(${item.rot}deg) rotateY(${float}deg)`;
          }
          item.el.style.transform = trans;
        }
      });

      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
      window.removeEventListener("mousemove", onMouse);
      world.innerHTML = "";
    };
  }, []);

  return (
    <div className="pg-root">
      <div className="pg-scroll-proxy" />

      <div className="pg-viewport" ref={viewportRef}>
        <div className="pg-world" ref={worldRef} />
      </div>

      <div className="pg-scanlines" />
      <div className="pg-vignette" />
      <div className="pg-noise" />

      <div className="pg-hud">
        <div className="pg-hud-top">
          <div className="pg-brand">
            <span className="pg-brand-mark">◢◤</span> POULTRYGRID&nbsp;AI
          </div>
          <div className="pg-hud-line" />
          <div>
            <strong>SYS.READY</strong> · FPS:&nbsp;<span ref={fpsRef}>60</span>
          </div>
        </div>

        <div className="pg-center-info">
          <h1 className="pg-hero-title">
            SMART POULTRY<br />FOR GHANA
          </h1>
          <p className="pg-hero-sub">
            IoT mesh · AI health · solar &amp; biogas · multi-farm RBAC.<br />
            Scroll to engage the grid.
          </p>
          <div className="pg-cta-row">
            <Link to="/login" search={{ mode: "signup" }} className="pg-cta pg-cta-primary">
              [ DEPLOY ACCOUNT ]
            </Link>
            <Link to="/login" className="pg-cta pg-cta-ghost">
              SIGN IN →
            </Link>
          </div>
        </div>

        <div className="pg-hud-bottom">
          <div>
            SCROLL VELOCITY //&nbsp;<span ref={velRef}>0.00</span>
          </div>
          <div className="pg-hud-line" />
          <div>
            COORD:&nbsp;<span ref={coordRef}>000.000</span> · VER 2.0.4 [BETA]
          </div>
        </div>
      </div>

      <style>{css}</style>
    </div>
  );
}

const css = `
.pg-root {
  --pg-bg: #030303;
  --pg-card-bg: rgba(10, 10, 10, 0.4);
  --pg-text: #e0e0e0;
  --pg-accent: #ff003c;
  --pg-accent-2: #00f3ff;
  --pg-border: rgba(255, 255, 255, 0.1);
  --pg-font-display: 'Syncopate', 'Arial Narrow', sans-serif;
  --pg-font-code: 'JetBrains Mono', ui-monospace, monospace;
  position: fixed;
  inset: 0;
  background: var(--pg-bg);
  color: var(--pg-text);
  font-family: var(--pg-font-display);
  overflow: hidden;
  cursor: crosshair;
}
.pg-scroll-proxy { height: 10000vh; position: absolute; width: 100%; z-index: -1; }
.pg-scanlines {
  position: fixed; inset: 0; pointer-events: none; z-index: 10;
  background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,.2) 50%, rgba(0,0,0,.2));
  background-size: 100% 4px;
}
.pg-vignette { position: fixed; inset: 0; pointer-events: none; z-index: 11; background: radial-gradient(circle, transparent 40%, #000 120%); }
.pg-noise {
  position: fixed; inset: 0; pointer-events: none; z-index: 12; opacity: 0.07;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.pg-hud {
  position: fixed; inset: 2rem; z-index: 20; pointer-events: none;
  display: flex; flex-direction: column; justify-content: space-between;
  font-family: var(--pg-font-code); font-size: 10px; color: rgba(255,255,255,.55); text-transform: uppercase;
}
.pg-hud-top, .pg-hud-bottom { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.pg-hud strong { color: var(--pg-accent-2); }
.pg-hud-line { flex: 1; height: 1px; background: rgba(255,255,255,.2); position: relative; }
.pg-hud-line::after { content: ''; position: absolute; right: 0; top: -2px; width: 5px; height: 5px; background: var(--pg-accent); }
.pg-brand { color: #fff; letter-spacing: .15em; font-weight: 700; }
.pg-brand-mark { color: var(--pg-accent); }

.pg-center-info {
  pointer-events: auto;
  align-self: center;
  text-align: center;
  max-width: 720px;
  mix-blend-mode: difference;
}
.pg-hero-title {
  font-family: var(--pg-font-display);
  font-size: clamp(2.2rem, 5.5vw, 4.5rem);
  font-weight: 700;
  letter-spacing: .02em;
  line-height: .95;
  margin: 0 0 1rem;
  color: #fff;
  text-transform: uppercase;
}
.pg-hero-sub {
  font-family: var(--pg-font-code);
  font-size: 11px;
  letter-spacing: .12em;
  color: rgba(255,255,255,.8);
  text-transform: uppercase;
  margin: 0 auto 1.5rem;
  line-height: 1.7;
}
.pg-cta-row { display: flex; gap: .75rem; justify-content: center; flex-wrap: wrap; }
.pg-cta {
  font-family: var(--pg-font-code);
  font-size: 11px;
  letter-spacing: .18em;
  padding: .85rem 1.25rem;
  text-decoration: none;
  text-transform: uppercase;
  border: 1px solid var(--pg-border);
  color: #fff;
  transition: all .2s;
  pointer-events: auto;
}
.pg-cta-primary { background: var(--pg-accent); border-color: var(--pg-accent); color: #fff; }
.pg-cta-primary:hover { background: #fff; color: var(--pg-accent); border-color: #fff; }
.pg-cta-ghost:hover { border-color: var(--pg-accent-2); color: var(--pg-accent-2); }

.pg-viewport { position: fixed; inset: 0; perspective: 1000px; overflow: hidden; z-index: 1; }
.pg-world { position: absolute; top: 50%; left: 50%; transform-style: preserve-3d; will-change: transform; }
.pg-item {
  position: absolute; left: 0; top: 0; backface-visibility: hidden;
  transform-origin: center center; display: flex; align-items: center; justify-content: center;
}
.pg-card {
  width: 340px; min-height: 440px; background: var(--pg-card-bg);
  border: 1px solid var(--pg-border); padding: 1.75rem;
  display: flex; flex-direction: column; gap: 1rem;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 0 0 1px rgba(0,0,0,.5), 0 20px 50px rgba(0,0,0,.5);
  transform: translate(-50%, -50%);
  position: relative;
  color: #fff;
}
.pg-card::before, .pg-card::after {
  content: ''; position: absolute; width: 12px; height: 12px; border: 1px solid #fff; transition: .3s;
}
.pg-card::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
.pg-card::after { bottom: -1px; right: -1px; border-left: none; border-top: none; }
.pg-card-header {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: .75rem; border-bottom: 1px solid var(--pg-border);
}
.pg-card-id { font-family: var(--pg-font-code); color: var(--pg-accent); font-size: .7rem; letter-spacing: .1em; }
.pg-card-dot { width: 10px; height: 10px; background: var(--pg-accent); }
.pg-card h2 {
  font-size: 1.75rem; line-height: .95; margin: 0; text-transform: uppercase;
  font-weight: 700; color: #fff; letter-spacing: .01em;
}
.pg-card-body {
  font-family: var(--pg-font-code); font-size: .75rem; line-height: 1.6;
  color: rgba(255,255,255,.75); margin: 0; text-transform: none; letter-spacing: .02em;
}
.pg-card-footer {
  margin-top: auto; font-family: var(--pg-font-code); font-size: .65rem;
  color: rgba(255,255,255,.45); display: flex; justify-content: space-between;
  letter-spacing: .1em; text-transform: uppercase;
}
.pg-card-num {
  position: absolute; bottom: 1rem; right: 1.25rem;
  font-size: 3.5rem; opacity: .08; font-weight: 900; color: #fff;
}
.pg-big-text {
  font-size: 14vw; font-weight: 700; color: transparent;
  -webkit-text-stroke: 2px rgba(255,255,255,.18);
  text-transform: uppercase; white-space: nowrap;
  transform: translate(-50%, -50%); pointer-events: none;
  letter-spacing: -.4rem; mix-blend-mode: overlay;
  font-family: var(--pg-font-display);
}
.pg-star { position: absolute; width: 2px; height: 2px; background: #fff; transform: translate(-50%, -50%); }

@media (max-width: 640px) {
  .pg-hud { inset: 1rem; }
  .pg-card { width: 260px; min-height: 380px; padding: 1.25rem; }
  .pg-card h2 { font-size: 1.35rem; }
}
`;
