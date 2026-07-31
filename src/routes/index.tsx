import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";

import fs from "../lib/shaders/fragment_shader.fs?raw";
import vs from "../lib/shaders/vertex_shader.vs?raw";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PoultryGrid AI — Smart Poultry Farm Management for Ghana" },
      {
        name: "description",
        content:
          "IoT + AI platform for poultry farms in Ghana. Real-time monitoring, hatchery control, disease prediction, ESP32 cameras, solar and biogas tracking.",
      },
      {
        property: "og:title",
        content: "PoultryGrid AI — Smart Poultry Farm Management",
      },
      {
        property: "og:description",
        content: "IoT mesh, AI health, solar & biogas, multi-farm RBAC.",
      },
      { property: "og:url", content: "/" },
    ],
    links: [
      { rel: "canonical", href: "/" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@300;400&display=swap",
      },
    ],
  }),
  component: Landing,
});

const SCENES = ["FARM 01", "FARM 02", "FARM 03", "FARM 04", "FARM 05"];

function Landing() {
  useEffect(() => {
    const canvas = document.getElementById(
      "webgl-canvas",
    ) as HTMLCanvasElement | null;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: false });
    if (!gl) {
      canvas.style.background = "#0a0a0f";
      return;
    }

    // const fs = ;

    const mkShader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };

    const prog = gl.createProgram()!;
    gl.attachShader(prog, mkShader(gl.VERTEX_SHADER, vs)!);
    gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, fs)!);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const ap = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(ap);
    gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);

    const uR = gl.getUniformLocation(prog, "uR");
    const uTi = gl.getUniformLocation(prog, "uT");
    const uScroll = gl.getUniformLocation(prog, "uS");
    const uScene = gl.getUniformLocation(prog, "uSc");
    const uBlend = gl.getUniformLocation(prog, "uBl");
    const uBg = gl.getUniformLocation(prog, "uBg");

    let maxScroll = 1;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uR, canvas.width, canvas.height);
      maxScroll = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
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
        e.deltaMode === 1
          ? e.deltaY * linePx
          : e.deltaMode === 2
            ? e.deltaY * pagePx
            : e.deltaY;
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
      document.querySelectorAll(
        ".tag, h1, h2, .body-text, .stat-row, .cta, .h-line",
      ),
    );
    revealEls.forEach((el) => {
      if (
        (el as HTMLElement).getBoundingClientRect().top <
        window.innerHeight * 0.92
      )
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

    const hexToVec3 = (hex: string) => {
      const n = parseInt(hex.replace("#", ""), 16);
      return [
        ((n >> 16) & 255) / 255,
        ((n >> 8) & 255) / 255,
        (n & 255) / 255,
      ] as const;
    };
    const bgColors: Record<string, string> = {
      dark: "#0a0a0f",
      light: "#f0ece3",
    };
    const updateBg = (theme: string) => {
      const [r, g, b] = hexToVec3(bgColors[theme] ?? bgColors.dark);
      gl.uniform3f(uBg, r, g, b);
    };
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = (theme: string) => {
      document.documentElement.setAttribute("data-theme", theme);
      (document.documentElement.style as any).colorScheme = theme;
      updateBg(theme);
    };
    applyTheme(mq.matches ? "dark" : "light");
    const onMq = (e: MediaQueryListEvent) =>
      applyTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", onMq);

    const themeBtn = document.getElementById("theme-toggle")!;
    const onThemeClick = () => {
      const current =
        document.documentElement.getAttribute("data-theme") ||
        (mq.matches ? "dark" : "light");
      applyTheme(current === "dark" ? "light" : "dark");
    };
    themeBtn.addEventListener("click", onThemeClick);

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

    const t0 = performance.now();
    let lastNow = t0;
    let rafId = 0;
    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame);
      const dt = Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;
      velocity *= Math.pow(0.85, dt * 60);
      if (Math.abs(velocity) > 0.2)
        window.scrollBy({ top: velocity * ease, behavior: "auto" });
      smooth += (tgt - smooth) * (1 - Math.exp(-dt * 8));
      const raw = smooth * (N - 1);
      const flr = Math.floor(raw);
      const si = Math.min(flr, N - 2);
      const bl = flr >= N - 1 ? 1.0 : raw - flr;
      updateHUD(smooth);
      gl.uniform1f(uTi, (now - t0) / 1000);
      gl.uniform1f(uScroll, smooth);
      gl.uniform1f(uScene, si);
      gl.uniform1f(uBlend, bl);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      stopAnchorAnim();
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("wheel", stopAnchorAnim);
      window.removeEventListener("touchstart", stopAnchorAnim);
      window.removeEventListener("mousedown", stopAnchorAnim);
      window.removeEventListener("keydown", stopAnchorAnim);
      mq.removeEventListener("change", onMq);
      themeBtn.removeEventListener("click", onThemeClick);
      anchorHandlers.forEach(({ a, fn }) => a.removeEventListener("click", fn));
      io.disconnect();
      document.documentElement.removeAttribute("data-theme");
    };
  }, []);

  return (
    <div className="pg-landing">
      <canvas id="webgl-canvas" />

      <div id="hud">
        <div id="hud-pct">000%</div>
        <div className="progress-bar">
          <div className="progress-fill" id="prog-fill" />
        </div>
        <div className="scene-label" id="scene-name">
          FARM 01
        </div>
      </div>

      <button id="theme-toggle" aria-label="Toggle light/dark mode">
        <svg
          className="icon-sun"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <svg
          className="icon-moon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
        </svg>
      </button>

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
              An IoT and AI platform connecting your farms, hatcheries and
              people. Scroll to explore real-time sensing, disease prediction
              and renewable power.
            </p>
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                flexWrap: "wrap",
                marginTop: "1.75rem",
              }}
            >
              <Link
                to="/login"
                search={{ mode: "signup" }}
                className="cta visible"
              >
                Deploy account
                <svg
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M1 6h10M6 1l5 5-5 5" />
                </svg>
              </Link>
              <Link to="/login" className="cta visible">
                Sign in
                <svg
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M1 6h10M6 1l5 5-5 5" />
                </svg>
              </Link>
            </div>
          </div>
        </section>

        <section id="s1">
          <div className="text-card right">
            <div className="h-line" />
            <div className="tag">01 — Sensing</div>
            <h2>
              LIVE
              <br />
              FARM PULSE
            </h2>
            <p className="body-text">
              ESP32 sensor nodes stream temperature, humidity, ammonia, water
              and feed levels from every house — second by second, across every
              farm.
            </p>
            <div className="stat-row" style={{ justifyContent: "flex-end" }}>
              <div className="stat">
                <span className="stat-num">1Hz</span>
                <span className="stat-label">Telemetry</span>
              </div>
              <div className="stat">
                <span className="stat-num">∞</span>
                <span className="stat-label">Devices</span>
              </div>
              <div className="stat">
                <span className="stat-num">24/7</span>
                <span className="stat-label">Monitoring</span>
              </div>
            </div>
          </div>
        </section>

        <section id="s2">
          <div className="text-card">
            <div className="h-line" />
            <div className="tag">02 — AI Health</div>
            <h2>
              PREDICT
              <br />
              PROTECT
            </h2>
            <p className="body-text">
              Computer vision on ESP32-CAM feeds plus anomaly detection on
              environmental data flag disease risk and behavioural changes
              before outbreaks spread.
            </p>
            <a className="cta" href="#s3">
              Continue
              <svg
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M1 6h10M6 1l5 5-5 5" />
              </svg>
            </a>
          </div>
        </section>

        <section id="s3">
          <div className="text-card center">
            <div className="h-line" />
            <div className="tag">03 — Hatchery</div>
            <h2>
              INCUBATE
              <br />
              AUTOMATE
            </h2>
            <p className="body-text">
              Twenty-one day cycles, candling logs, turning schedules and
              predicted hatch dates. Feeders, vents and cooling respond
              automatically to your thresholds.
            </p>
          </div>
        </section>

        <section id="s4">
          <div className="text-card right">
            <div className="h-line" />
            <div className="tag">04 — Power & Team</div>
            <h2>
              SOLAR
              <br />
              BIOGAS
              <br />
              SCALE
            </h2>
            <p className="body-text">
              Track PV generation, battery state and waste-to-energy from manure
              digesters. Multi-farm RBAC for owners, managers and workers —
              scoped per house and device.
            </p>
            <Link
              to="/login"
              search={{ mode: "signup" }}
              className="cta visible"
            >
              Get started
              <svg
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
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
  --dark-bg: #0a0a0f;
  --dark-fg: #e8e4d9;
  --dark-muted: #6a6a7e;
  --light-bg: #f0ece3;
  --light-fg: #0d0d14;
  --light-muted: #9a9aaa;
  --accent-dark: #c8ff47;
  --accent-light: #3a6e00;
  --bg: var(--dark-bg);
  --fg: var(--dark-fg);
  --muted: var(--dark-muted);
  --accent: var(--accent-dark);
  --card-bg: rgba(10, 10, 15, 0.82);
  --card-border: rgba(200, 255, 71, 0.18);
  --font-display: "Bebas Neue", sans-serif;
  --font-mono: "DM Mono", monospace;
  --hairline: 0.0625rem;
  --ui-inset: 2rem;
  --nav-x: calc(var(--ui-inset) + 0.125rem);
  --reveal-offset: 0.625rem;
  --reveal-duration: 0.5s;
  --z-ui: 10;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-mono);
  min-height: 100vh;
}
:root[data-theme="light"] .pg-landing {
  --bg: var(--light-bg);
  --fg: var(--light-fg);
  --muted: var(--light-muted);
  --accent: var(--accent-light);
  --card-bg: rgba(240, 236, 227, 0.88);
  --card-border: rgba(58, 110, 0, 0.2);
}
.pg-landing *, .pg-landing *::before, .pg-landing *::after {
  box-sizing: border-box; margin: 0; padding: 0;
}
body:has(.pg-landing) { overflow-x: hidden; background: var(--dark-bg); }
:root[data-theme="light"] body:has(.pg-landing) { background: var(--light-bg); }

#webgl-canvas {
  position: fixed; inset: 0; width: 100vw; height: 100vh;
  z-index: 0; pointer-events: none;
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

#theme-toggle {
  position: fixed; bottom: var(--ui-inset); left: var(--nav-x); translate: -50% 0;
  z-index: var(--z-ui); width: 2rem; height: 2rem; border: none;
  background: color-mix(in srgb, var(--muted) 35%, transparent);
  border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 0.3s;
}
#theme-toggle:hover { background: color-mix(in srgb, var(--muted) 55%, transparent); }
#theme-toggle svg {
  width: 0.875rem; height: 0.875rem; position: absolute;
  transition: opacity 0.3s ease, rotate 0.3s ease; color: var(--accent);
}
:root[data-theme="light"] #theme-toggle svg { color: var(--fg); }
#theme-toggle .icon-sun { opacity: 1; rotate: 0deg; }
#theme-toggle .icon-moon { opacity: 0; rotate: 90deg; }
:root[data-theme="light"] #theme-toggle .icon-sun { opacity: 0; rotate: -90deg; }
:root[data-theme="light"] #theme-toggle .icon-moon { opacity: 1; rotate: 0deg; }

#scroll-container { position: relative; z-index: 1; }
.pg-landing section {
  min-height: 100vh; display: flex; align-items: center; padding: 6rem 5rem;
}
.text-card {
  max-width: 23.75rem; padding: 2.25rem 2rem; background: var(--card-bg);
  border-left: var(--hairline) solid var(--card-border);
  transition: background 0.3s ease, border-color 0.3s ease;
}
.text-card.right {
  margin-inline-start: auto; border-left: none;
  border-right: var(--hairline) solid var(--card-border); text-align: right;
}
.text-card.center {
  margin-inline: auto; border-left: none;
  border-top: var(--hairline) solid var(--card-border); text-align: center; max-width: 28.75rem;
}
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
  font-size: 0.78rem; line-height: 1.8; color: color-mix(in srgb, var(--fg) 55%, transparent);
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
  padding: 0.6rem 1.25rem; border: var(--hairline) solid var(--accent);
  color: var(--accent); font-family: var(--font-mono); font-size: 0.62rem;
  letter-spacing: 0.18em; text-transform: uppercase; text-decoration: none; cursor: pointer;
  opacity: 0; translate: 0 var(--reveal-offset);
  transition: opacity var(--reveal-duration) ease 0.35s, translate var(--reveal-duration) ease 0.35s, background 0.2s, color 0.2s;
}
.pg-landing .cta.visible { opacity: 1; translate: 0 0; }
.pg-landing .cta:hover { background: var(--accent); color: var(--bg); }
.pg-landing .cta svg { width: 0.6875rem; height: 0.6875rem; }

#credit {
  position: fixed; right: var(--ui-inset); top: 50%;
  transform: translateY(-50%) rotate(-90deg); transform-origin: right center;
  z-index: var(--z-ui); font-family: var(--font-mono); font-size: 0.65rem;
  letter-spacing: 0.15em; text-transform: uppercase;
}
#credit a { color: var(--muted); text-decoration: none; }

@media (max-width: 600px) {
  .pg-landing section { padding: 5rem 1.5rem; }
  #hud { top: 1rem; right: 1rem; }
  #scene-strip { display: none; }
  .text-card { max-width: 100%; }
  #theme-toggle { bottom: 1rem; left: 1.25rem; translate: 0 0; }
}
`;
