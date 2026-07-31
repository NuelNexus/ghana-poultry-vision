import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";

import fs from "../lib/shaders/fragment_shader.fs?raw";
import vs from "../lib/shaders/vertex_shader.vs?raw";
import css from "./index.css?raw";

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
