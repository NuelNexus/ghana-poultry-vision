// Build the guide videos with HyperFrames (https://github.com/heygen-com/hyperframes).
//
//   node videos/build.mjs                 # every guide, English and Twi
//   node videos/build.mjs coop tw         # one guide, one language
//   node videos/build.mjs --no-render     # write the projects only
//
// For each guide in videos/guides.mjs and each language it writes a
// HyperFrames project to videos/build/<slug>-<lang>/ (index.html plus one
// sub-composition per scene), runs `hyperframes check`, renders it, and puts
// <slug>-<lang>.mp4 and a poster .jpg in public/guides/. Screenshots come from
// videos/shots/ (real screens of the app; rects.json has the boxes the camera
// moves to). Needs Node 22, FFmpeg and Chrome (`npx hyperframes browser ensure`).

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDES } from "./guides.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SHOTS = join(HERE, "shots");
const OUT = join(ROOT, "public", "guides");
const HF = ["--yes", "hyperframes@0.8.210"];
const RECTS = JSON.parse(readFileSync(join(SHOTS, "rects.json"), "utf8"));

const W = 1920;
const H = 1080;
const BRAND = "#2f5d3a";
const PAPER = "#f4f2ec";
const INK = "#1c211c";
const GOLD = "#f2b705";

const LANGS = ["en", "tw"];

// --- timing ------------------------------------------------------------------

const words = (s) => s.trim().split(/\s+/).length;
/** Long enough to read: 0.9 s plus 0.33 s a word, never under 2.8 s. */
const beatLen = (text) => Math.max(2.8, 0.9 + 0.33 * words(text));
const FADE = 0.35;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r1 = (n) => Math.round(n * 100) / 100;

// --- shared pieces -------------------------------------------------------------

const LOGO = (size) => `<svg viewBox="0 0 28 28" width="${size}" height="${size}" aria-hidden="true">
  <rect width="28" height="28" rx="6" fill="${BRAND}"/>
  <path d="M7 13.2 14 7.6l7 5.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M14 12.4c-1.9 0-3.4 2.7-3.4 5.1 0 2 1.5 3.4 3.4 3.4s3.4-1.4 3.4-3.4c0-2.4-1.5-5.1-3.4-5.1Z" fill="#fff"/>
</svg>`;

const BASE_CSS = `
  #root *, #root *::before, #root *::after { box-sizing: border-box; }
  #root { position: absolute; inset: 0; overflow: hidden; font-family: "Inter", sans-serif; color: ${INK}; }
  .fade { position: absolute; inset: 0; }
  .capwrap { position: absolute; left: 0; right: 0; bottom: 100px; display: flex; justify-content: center; z-index: 20; }
  .cap { max-width: 1480px; padding: 22px 38px; border-radius: 18px; background: rgba(24, 30, 24, 0.93);
         color: #fff; font-size: 46px; line-height: 1.24; font-weight: 700; text-align: center; letter-spacing: -0.005em; }
`;

/** Caption clips: one per beat, text animated on the child. */
function captions(id, beats, lang) {
  const html = beats
    .map(
      (b, i) =>
        `<div id="${id}-c${i}" class="clip capwrap" data-start="${r1(b.t)}" data-duration="${r1(b.d)}"><div class="cap">${esc(b.text[lang])}</div></div>`,
    )
    .join("\n");
  const js = beats
    .map(
      (b, i) =>
        `tl.fromTo("#${id}-c${i} .cap", { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.32, ease: "power3.out" }, ${r1(b.t + 0.05)});`,
    )
    .join("\n");
  return { html, js };
}

function sceneFile(id, css, body, js, duration, first = false) {
  return `<template>
<style>
${BASE_CSS}
${css}
</style>
<div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
<div id="${id}-fade" class="fade">
${body}
</div>
</div>
<script>
const tl = gsap.timeline({ paused: true });
${first ? "" : `tl.fromTo("#${id}-fade", { opacity: 0 }, { opacity: 1, duration: ${FADE}, ease: "none" }, 0);`}
${js}
tl.to("#${id}-fade", { opacity: 0, duration: ${FADE}, ease: "none" }, ${r1(duration - FADE)});
window.__timelines["${id}"] = tl;
</script>
</template>
`;
}

/** Lay beats out one after another from `lead`; returns the scene length. */
function layout(beats, lang, lead) {
  let t = lead;
  for (const b of beats) {
    b.t = t;
    b.d = beatLen(b.text[lang]);
    t += b.d;
  }
  return t + 0.4;
}

// --- scene: title / end ------------------------------------------------------

function titleScene(id, s, lang, kicker, first) {
  const dur = Math.max(4.2, 1.6 + 0.3 * words(s.title[lang] + " " + s.sub[lang]));
  const css = `
    #${id}-bg { position: absolute; inset: 0; background: ${BRAND}; }
    #${id}-brand { position: absolute; left: 160px; top: 140px; display: flex; align-items: center; gap: 20px;
                   color: #fff; font-size: 38px; font-weight: 800; }
    #${id}-brand svg rect { fill: #fff; } #${id}-brand svg path { stroke: ${BRAND}; } #${id}-brand svg path + path { fill: ${BRAND}; }
    #${id}-kick { position: absolute; left: 160px; top: 380px; font-size: 34px; font-weight: 700; color: #cfe3d3;
                  letter-spacing: 0.04em; text-transform: uppercase; }
    #${id}-title { position: absolute; left: 160px; right: 160px; top: 440px; transform-origin: 0 50%; font-size: 104px; line-height: 1.04;
                   font-weight: 900; color: #fff; letter-spacing: -0.02em; }
    #${id}-sub { position: absolute; left: 160px; right: 160px; top: 690px; font-size: 48px; font-weight: 500; color: #dfeee2; }
  `;
  const body = `
    <div id="${id}-bg"></div>
    <div id="${id}-brand">${LOGO(64)}<span>PoultryGrid</span></div>
    <div id="${id}-kick">${esc(kicker[lang])}</div>
    <div id="${id}-title">${esc(s.title[lang])}</div>
    <div id="${id}-sub">${esc(s.sub[lang])}</div>`;
  // The first scene is the thumbnail: everything is already on screen at 0 s and only moves into place.
  const o = first ? 1 : 0;
  const js = `
    tl.fromTo("#${id}-brand", { opacity: ${o}, y: -14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, ${first ? 0 : 0.15});
    tl.fromTo("#${id}-kick", { opacity: ${o}, x: -24 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" }, ${first ? 0 : 0.35});
    tl.fromTo("#${id}-title", { opacity: ${o}, y: 40 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, ${first ? 0 : 0.5});
    tl.fromTo("#${id}-sub", { opacity: ${o}, y: 24 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, ${first ? 0.1 : 0.85});
    tl.fromTo("#${id}-title", { scale: 1 }, { scale: 1.03, duration: ${r1(dur - 0.6)}, ease: "none" }, 0.6);`;
  return { dur, html: sceneFile(id, css, body, js, dur, first) };
}

function endScene(id, s, lang) {
  const dur = Math.max(3.6, 1.4 + 0.33 * words(s.text[lang]));
  const css = `
    #${id}-bg { position: absolute; inset: 0; background: ${PAPER}; }
    #${id}-line { position: absolute; left: 200px; right: 200px; top: 360px; text-align: center; font-size: 76px;
                  line-height: 1.12; font-weight: 800; letter-spacing: -0.015em; }
    #${id}-brand { position: absolute; left: 0; right: 0; top: 700px; display: flex; justify-content: center;
                   align-items: center; gap: 18px; font-size: 40px; font-weight: 800; color: ${BRAND}; }
  `;
  const body = `
    <div id="${id}-bg"></div>
    <div id="${id}-line">${esc(s.text[lang])}</div>
    <div id="${id}-brand">${LOGO(58)}<span>PoultryGrid</span></div>`;
  const js = `
    tl.fromTo("#${id}-line", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.55, ease: "power3.out" }, 0.2);
    tl.fromTo("#${id}-brand", { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.6)" }, 0.75);
    tl.fromTo("#${id}-line", { scale: 1 }, { scale: 1.03, duration: ${r1(dur - 0.8)}, ease: "none" }, 0.75);`;
  return { dur, html: sceneFile(id, css, body, js, dur) };
}

// --- scene: screenshot with camera moves ------------------------------------------

function focusRect(img, focus) {
  if (Array.isArray(focus)) {
    const rs = focus.map((f) => focusRect(img, f));
    const x = Math.min(...rs.map((r) => r.x));
    const y = Math.min(...rs.map((r) => r.y));
    return {
      x,
      y,
      w: Math.max(...rs.map((r) => r.x + r.w)) - x,
      h: Math.max(...rs.map((r) => r.y + r.h)) - y,
    };
  }
  if (typeof focus === "object") return focus;
  const r = RECTS[img]?.[focus];
  if (!r) throw new Error(`No rect "${focus}" for shot "${img}" in videos/shots/rects.json`);
  return r;
}

/** Scale and offset that put the focus box in the upper middle of the frame (captions sit below). */
function camera(r, zoom, exact = false) {
  const auto = Math.min(2.2, (0.62 * W) / r.w, (0.42 * H) / r.h);
  const s = exact ? Math.max(1, zoom) : Math.max(1, Math.min(zoom ?? auto, auto * 1.4, 2.4));
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let x = W / 2 - s * cx;
  let y = 430 - s * cy;
  x = Math.min(0, Math.max(W - s * W, x));
  y = Math.min(0, Math.max(H - s * H, y));
  return { s: r1(s), x: Math.round(x), y: Math.round(y) };
}

function shotScene(id, s, lang) {
  const beats = s.beats.map((b) => ({ ...b }));
  const dur = layout(beats, lang, 0.7);
  const css = `
    #${id}-bg { position: absolute; inset: 0; background: #e6e3db; }
    #${id}-cam { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 0 0; }
    #${id}-cam > img { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }
    .hl { position: absolute; border-radius: 14px; border: 4px solid ${GOLD};
          box-shadow: 0 0 0 3000px rgba(20, 26, 20, 0.34), 0 0 30px rgba(242, 183, 5, 0.55); }
  `;
  const hls = beats
    .map((b, i) => {
      const r = focusRect(s.img, b.focus);
      const cam = camera(r, b.zoom);
      b.cam = cam;
      // Slow push-in while the caption is read, so the frame never sits still.
      b.drift = camera(r, cam.s * 1.035, true);
      const pad = 10;
      const bw = Math.max(2, r1(4 / cam.s));
      return `<div id="${id}-h${i}" class="clip" data-start="${r1(b.t + 0.55)}" data-duration="${r1(b.d - 0.55)}" data-layout-allow-overflow data-layout-ignore><div class="hl" style="left:${r.x - pad}px;top:${r.y - pad}px;width:${r.w + pad * 2}px;height:${r.h + pad * 2}px;border-width:${bw}px;border-radius:${r1(14 / cam.s)}px"></div></div>`;
    })
    .join("\n");
  const cap = captions(id, beats, lang);
  const body = `
    <div id="${id}-bg"></div>
    <div id="${id}-cam" data-layout-allow-overflow><img src="assets/${s.img}.png" alt="">
    ${hls}
    </div>
    ${cap.html}`;
  const moves = beats
    .map(
      (b, i) =>
        `tl.to("#${id}-cam", { x: ${b.cam.x}, y: ${b.cam.y}, scale: ${b.cam.s}, duration: 0.85, ease: "power2.inOut" }, ${r1(b.t - 0.25)});
tl.to("#${id}-cam", { x: ${b.drift.x}, y: ${b.drift.y}, scale: ${b.drift.s}, duration: ${r1(Math.max(0.5, b.d - 0.85))}, ease: "none" }, ${r1(b.t + 0.6)});
tl.fromTo("#${id}-h${i} .hl", { opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1, duration: 0.3, ease: "power2.out" }, ${r1(b.t + 0.55)});`,
    )
    .join("\n");
  const js = `tl.set("#${id}-cam", { x: 0, y: 0, scale: 1 }, 0);\n${moves}\n${cap.js}`;
  return { dur, html: sceneFile(id, css, body, js, dur), assets: [`${s.img}.png`] };
}

// --- scene: phone ------------------------------------------------------------------------

function phoneScene(id, s, lang) {
  const beats = s.beats.map((b) => ({ ...b }));
  const dur = layout(beats, lang, 0.5);
  const sw = 360;
  const sh = 779;
  const fx = Math.round((W - (sw + 32)) / 2);
  const css = `
    #${id}-bg { position: absolute; inset: 0; background: ${PAPER}; }
    #${id}-phone { position: absolute; left: ${fx}px; top: 50px; width: ${sw + 32}px; height: ${sh + 32}px;
                   border-radius: 56px; background: #111; box-shadow: 0 30px 80px rgba(0,0,0,0.25); }
    #${id}-phone img { position: absolute; left: 16px; top: 16px; width: ${sw}px; height: ${sh}px; border-radius: 42px; }
  `;
  const cap = captions(id, beats, lang);
  const body = `<div id="${id}-bg"></div>
    <div id="${id}-phone" data-layout-allow-overflow><img src="assets/${s.img}.png" alt=""></div>
    ${cap.html}`;
  const js = `tl.fromTo("#${id}-phone", { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, 0.1);
tl.to("#${id}-phone", { y: -40, duration: ${r1(Math.max(0.5, dur - 0.8))}, ease: "none" }, 0.8);
${cap.js}`;
  return { dur, html: sceneFile(id, css, body, js, dur), assets: [`${s.img}.png`] };
}

// --- scene: unit diagrams -------------------------------------------------------------------

const L = (en, tw) => ({ en, tw });

/** A labelled box. `icon` is inline SVG. */
function box(id, key, x, y, w, h, title, sub, lang, icon = "", extraClass = "") {
  return `<div id="${id}-${key}" class="part ${extraClass}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
    ${icon ? `<div class="ico">${icon}</div>` : ""}
    <div class="ptxt"><div class="pt">${esc(title)}</div>${sub ? `<div class="ps">${esc(sub[lang] ?? sub)}</div>` : ""}</div>
  </div>`;
}

const ICON = {
  chip: `<svg viewBox="0 0 48 48" width="56" height="56"><rect x="8" y="8" width="32" height="32" rx="5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 2v6M24 2v6M32 2v6M16 40v6M24 40v6M32 40v6M2 16h6M2 24h6M2 32h6M40 16h6M40 24h6M40 32h6" stroke="currentColor" stroke-width="3"/></svg>`,
  thermo: `<svg viewBox="0 0 48 48" width="56" height="56"><path d="M20 8a4 4 0 0 1 8 0v20a8 8 0 1 1-8 0Z" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="34" r="4" fill="currentColor"/><path d="M24 30V16" stroke="currentColor" stroke-width="3"/></svg>`,
  gas: `<svg viewBox="0 0 48 48" width="56" height="56"><circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 26c3-6 5 4 8-2s5 4 8-2" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  sun: `<svg viewBox="0 0 48 48" width="56" height="56"><circle cx="24" cy="24" r="8" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 4v6M24 38v6M4 24h6M38 24h6M10 10l4 4M34 34l4 4M10 38l4-4M34 14l4-4" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  fan: `<svg viewBox="0 0 48 48" width="64" height="64"><g class="spin"><path d="M24 24c0-9 4-16 10-14 5 2 1 10-10 14ZM24 24c9 0 16 4 14 10-2 5-10 1-14-10ZM24 24c0 9-4 16-10 14-5-2-1-10 10-14ZM24 24c-9 0-16-4-14-10 2-5 10-1 14 10Z" fill="currentColor"/></g><circle cx="24" cy="24" r="3.5" fill="#fff"/></svg>`,
  lamp: `<svg viewBox="0 0 48 48" width="64" height="64"><path class="bulb" d="M24 6a12 12 0 0 0-7 21.7V33h14v-5.3A12 12 0 0 0 24 6Z" fill="currentColor"/><path d="M18 38h12M20 43h8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  wifi: `<svg viewBox="0 0 48 48" width="56" height="56"><path d="M6 18a26 26 0 0 1 36 0M12 25a17 17 0 0 1 24 0M18 32a8 8 0 0 1 12 0" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><circle cx="24" cy="39" r="3" fill="currentColor"/></svg>`,
  phone: `<svg viewBox="0 0 48 48" width="56" height="56"><rect x="14" y="4" width="20" height="40" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M21 38h6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  drop: `<svg viewBox="0 0 48 48" width="56" height="56"><path d="M24 5s13 15 13 24a13 13 0 0 1-26 0C11 20 24 5 24 5Z" fill="none" stroke="currentColor" stroke-width="3"/></svg>`,
};

const DIAGRAM_CSS = (id) => `
  #${id}-bg { position: absolute; inset: 0; background: ${PAPER}; }
  .part { position: absolute; display: flex; align-items: center; gap: 18px; padding: 18px 22px; border-radius: 18px;
          background: #fff; border: 2px solid #ddd9cf; box-shadow: 0 6px 18px rgba(0,0,0,0.06); color: ${INK}; }
  .part .ico { color: ${BRAND}; flex: none; display: flex; }
  .pt { font-size: 32px; font-weight: 800; letter-spacing: -0.01em; }
  .ps { font-size: 28px; font-weight: 500; color: #4b524a; margin-top: 2px; line-height: 1.2; }
  .board { background: ${BRAND}; border-color: #244a2e; color: #fff; justify-content: center; flex-direction: column; text-align: center; }
  .board .ico, .board .ps { color: #d6e8da; }
  .zone { align-items: flex-start; flex-direction: column; background: #fbfaf6; }
  .ring { position: absolute; border-radius: 22px; border: 5px solid ${GOLD}; box-shadow: 0 0 26px rgba(242,183,5,0.5); opacity: 0; }
  svg.wires { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }
  .wire { fill: none; stroke: #b9b3a5; stroke-width: 4; stroke-dasharray: 10 10; }
  .chip { position: absolute; padding: 10px 20px; border-radius: 999px; font-size: 28px; font-weight: 800; color: #fff; }
`;

/** Reveal each part at its first beat; ring it while its beat plays. */
function diagramScene(id, s, lang, parts, extraJs = () => "") {
  const beats = s.beats.map((b) => ({ ...b }));
  const dur = layout(beats, lang, 0.5);
  const firstBeat = {};
  beats.forEach((b, i) => {
    if (!(b.part in firstBeat)) firstBeat[b.part] = i;
  });
  const cap = captions(id, beats, lang);
  const rings = beats
    .map((b, i) => {
      const p = parts.rings[b.part];
      if (!p) return "";
      const pad = 12;
      return `<div id="${id}-r${i}" class="clip" data-start="${r1(b.t)}" data-duration="${r1(b.d)}" data-layout-ignore><div class="ring" style="left:${p.x - pad}px;top:${p.y - pad}px;width:${p.w + pad * 2}px;height:${p.h + pad * 2}px"></div></div>`;
    })
    .join("\n");
  const reveals = Object.entries(parts.reveal)
    .map(([part, sels]) => {
      const at = part === "*" ? 0.15 : beats[firstBeat[part]]?.t ?? 0.15;
      return sels
        .map(
          (sel, k) =>
            `tl.fromTo("${sel}", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, ${r1(at + 0.08 * k)});`,
        )
        .join("\n");
    })
    .join("\n");
  const ringJs = beats
    .map((b, i) =>
      parts.rings[b.part]
        ? `tl.fromTo("#${id}-r${i} .ring", { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: 0.3, ease: "power2.out" }, ${r1(b.t + 0.1)});`
        : "",
    )
    .join("\n");
  const body = `<div id="${id}-bg"></div><div id="${id}-stage" class="fade" style="transform-origin:50% 40%">${parts.html}\n${rings}</div>\n${cap.html}`;
  const js = `${reveals}\n${ringJs}\n${extraJs(beats, firstBeat)}\n${cap.js}
tl.fromTo("#${id}-stage", { scale: 1 }, { scale: 1.035, duration: ${r1(dur)}, ease: "none" }, 0);`;
  return { dur, html: sceneFile(id, DIAGRAM_CSS(id) + (parts.css ?? ""), body, js, dur) };
}

function brooderParts(id, lang) {
  const P = {
    pi: { x: 740, y: 260, w: 420, h: 250 },
    dht: { x: 120, y: 120, w: 440, h: 130 },
    gas: { x: 120, y: 320, w: 440, h: 130 },
    ldr: { x: 120, y: 520, w: 440, h: 130 },
    fan: { x: 1350, y: 150, w: 440, h: 150 },
    site: { x: 1350, y: 470, w: 440, h: 150 },
  };
  const ai = { x: 740, y: 560, w: 420, h: 66 };
  const html = `
  <svg class="wires" id="${id}-wires">
    <path id="${id}-w-dht" class="wire" d="M560 185 C 650 185, 650 330, 740 330"/>
    <path id="${id}-w-gas" class="wire" d="M560 385 L 740 385"/>
    <path id="${id}-w-ldr" class="wire" d="M560 585 C 650 585, 650 440, 740 440"/>
    <path id="${id}-w-fan" class="wire" d="M1160 330 C 1250 330, 1250 225, 1350 225"/>
    <path id="${id}-w-site" class="wire" d="M1160 440 C 1250 440, 1250 545, 1350 545"/>
  </svg>
  ${box(id, "pi", P.pi.x, P.pi.y, P.pi.w, P.pi.h, "Raspberry Pi", L("Unit 1 · incubator & brooder", "Adwinnade 1 · incubator ne brooder"), lang, ICON.chip, "board")}
  ${box(id, "dht", P.dht.x, P.dht.y, P.dht.w, P.dht.h, "DHT22", L("Temperature & humidity", "Ɔhyew ne nsuo a ɛwɔ mframa mu"), lang, ICON.thermo)}
  ${box(id, "gas", P.gas.x, P.gas.y, P.gas.w, P.gas.h, "MQ-135", L("Ammonia gas", "Ammonia gas"), lang, ICON.gas)}
  ${box(id, "ldr", P.ldr.x, P.ldr.y, P.ldr.w, P.ldr.h, "LDR", L("Light", "Hann"), lang, ICON.sun)}
  ${box(id, "fan", P.fan.x, P.fan.y, P.fan.w, P.fan.h, L("Relay → fan", "Relay → fan")[lang], L("On or off, by itself", "Ɛno ankasa sɔ anaa dum"), lang, ICON.fan)}
  ${box(id, "site", P.site.x, P.site.y, P.site.w, P.site.h, "PoultryGrid", L("Reports every 30 s", "Ɛbɔ amaneɛ sekan 30 biara"), lang, ICON.phone)}
  <div id="${id}-ai" style="position:absolute;left:${ai.x}px;top:${ai.y}px;width:${ai.w}px;height:${ai.h}px;display:flex;gap:12px;justify-content:center">
    <span class="chip" style="position:relative;background:#2a7047">Healthy</span>
    <span class="chip" style="position:relative;background:#96600f">Warning</span>
    <span class="chip" style="position:relative;background:#b42318">Critical</span>
  </div>`;
  return {
    html,
    rings: { ...P, ai },
    reveal: {
      pi: [`#${id}-pi`],
      dht: [`#${id}-dht`, `#${id}-w-dht`],
      gas: [`#${id}-gas`, `#${id}-w-gas`],
      ldr: [`#${id}-ldr`, `#${id}-w-ldr`],
      ai: [`#${id}-ai`],
      fan: [`#${id}-fan`, `#${id}-w-fan`],
      site: [`#${id}-site`, `#${id}-w-site`],
    },
  };
}

function coopParts(id, lang) {
  const Z = { layers: { x: 110, y: 90, w: 560, h: 470 }, broilers: { x: 1250, y: 90, w: 560, h: 470 } };
  const esp = { x: 810, y: 300, w: 300, h: 190 };
  const water = { x: 740, y: 560, w: 440, h: 150 };
  const wifi = { x: 760, y: 70, w: 400, h: 140 };
  const hot = L("Too hot → fan on", "Hyew dodo → fan bɔ")[lang];
  const cold = L("Too cold → lamp on", "Nwini dodo → kanea sɔ")[lang];
  const zone = (key, title, sensor, temp, z, rule) => `
    <div id="${id}-${key}" class="part zone" style="left:${z.x}px;top:${z.y}px;width:${z.w}px;height:${z.h}px">
      <div class="pt">${esc(title)}</div>
      <div id="${id}-${key}-kit" style="display:flex;gap:16px;margin-top:22px">
        <div class="part" style="position:relative;flex-direction:column;gap:6px;padding:16px;width:160px"><div class="ico">${ICON.thermo}</div><div class="pt" style="font-size:28px">${sensor}</div><div id="${id}-${key}-t" class="ps" style="font-size:30px;font-weight:800;color:${INK}">${temp}</div></div>
        <div class="part" style="position:relative;flex-direction:column;gap:6px;padding:16px;width:160px"><div class="ico" id="${id}-${key}-fan">${ICON.fan}</div><div class="pt" style="font-size:28px">Fan</div></div>
        <div class="part" style="position:relative;flex-direction:column;gap:6px;padding:16px;width:160px"><div class="ico" id="${id}-${key}-lamp" style="color:#b9b3a5">${ICON.lamp}</div><div class="pt" style="font-size:28px">${esc(L("Heat lamp", "Kanea")[lang])}</div></div>
      </div>
      <div id="${id}-${key}-rule" class="ps" style="margin-top:22px;font-size:30px;font-weight:700;color:${INK}">${esc(rule)}</div>
    </div>`;
  const html = `
  <svg class="wires">
    <path id="${id}-w-l" class="wire" d="M670 395 L 810 395"/>
    <path id="${id}-w-b" class="wire" d="M1110 395 L 1250 395"/>
    <path id="${id}-w-w" class="wire" d="M960 490 L 960 560"/>
    <path id="${id}-w-n" class="wire" d="M960 210 L 960 300"/>
  </svg>
  ${box(id, "esp", esp.x, esp.y, esp.w, esp.h, "ESP32", L("Unit 2 · coop", "Adwinnade 2 · nkokɔ dan"), lang, ICON.chip, "board")}
  ${zone("layers", L("Layers", "Nkokɔ a wɔto nkosua")[lang], "DHT22", "26 °C", Z.layers, hot)}
  ${zone("broilers", "Broilers", "DHT11", "17 °C", Z.broilers, cold)}
  ${box(id, "water", water.x, water.y, water.w, water.h, L("Drinking water", "Nsuo a wɔnom")[lang], L("Turbidity sensor", "Nsuo sensa"), lang, ICON.drop)}
  ${box(id, "wifi", wifi.x, wifi.y, wifi.w, wifi.h, "Wi-Fi → PoultryGrid", L("Every 10 s", "Sekan 10 biara"), lang, ICON.wifi)}`;
  return {
    html,
    rings: {
      esp,
      layers: Z.layers,
      broilers: Z.broilers,
      kit: { x: Z.layers.x, y: Z.layers.y + 70, w: Z.broilers.x + Z.broilers.w - Z.layers.x, h: 250 },
      auto: { x: Z.layers.x, y: Z.layers.y, w: Z.broilers.x + Z.broilers.w - Z.layers.x, h: Z.layers.h },
      water,
      wifi,
    },
    reveal: {
      esp: [`#${id}-esp`],
      layers: [`#${id}-layers`, `#${id}-w-l`],
      broilers: [`#${id}-broilers`, `#${id}-w-b`],
      kit: [`#${id}-layers-kit`, `#${id}-broilers-kit`],
      water: [`#${id}-water`, `#${id}-w-w`],
      wifi: [`#${id}-wifi`, `#${id}-w-n`],
    },
  };
}

function coopExtraJs(id, lang) {
  return (beats, first) => {
    const a = beats[first.auto];
    if (!a) return "";
    return `
      tl.fromTo("#${id}-layers-rule, #${id}-broilers-rule", { opacity: 0 }, { opacity: 1, duration: 0.4 }, ${r1(a.t + 0.2)});
      tl.fromTo("#${id}-layers-fan .spin", { rotation: 0, svgOrigin: "24 24" }, { rotation: 1440, svgOrigin: "24 24", duration: ${r1(beats.at(-1).t + beats.at(-1).d - a.t)}, ease: "none" }, ${r1(a.t)});
      tl.to("#${id}-broilers-lamp", { color: "#e8a20c", duration: 0.4 }, ${r1(a.t + 0.3)});
      tl.fromTo("#${id}-broilers-lamp", { filter: "drop-shadow(0 0 0px #f2b705)" }, { filter: "drop-shadow(0 0 16px #f2b705)", duration: 0.5 }, ${r1(a.t + 0.3)});`;
  };
}

function brooderExtraJs(id) {
  return (beats, first) => {
    const f = beats[first.fan];
    if (!f) return "";
    const end = beats.at(-1).t + beats.at(-1).d;
    return `tl.fromTo("#${id}-fan .spin", { rotation: 0, svgOrigin: "24 24" }, { rotation: ${Math.round((end - f.t) * 360)}, svgOrigin: "24 24", duration: ${r1(end - f.t)}, ease: "none" }, ${r1(f.t)});`;
  };
}

// --- scene: LCD (screens exactly as firmware/coop_unit prints them) --------------------------

const LCD_SCREENS = [
  ["WELCOME TO", "POULTRY GRID"],
  ["LAYERS 23.0°C", "F:ON  L:OFF MAN"],
  ["BROILER 17.4°C", "F:OFF L:ON  AUT"],
  ["WATER: GOOD", "V:3.21"],
  ["SITE: ONLINE", "SETTINGS v4"],
];

function lcdScene(id, s, lang) {
  const beats = s.beats.map((b) => ({ ...b }));
  const dur = layout(beats, lang, 0.5);
  const cell = 52;
  const row = (txt) =>
    txt
      .padEnd(16)
      .split("")
      .map((ch) => `<span class="cell">${ch === " " ? "&nbsp;" : esc(ch)}</span>`)
      .join("");
  const screens = beats
    .map(
      (b, i) =>
        `<div id="${id}-l${i}" class="clip screen" data-start="${r1(i === 0 ? 0 : b.t)}" data-duration="${r1(i === beats.length - 1 ? dur - (i === 0 ? 0 : b.t) : beats[i + 1].t - (i === 0 ? 0 : b.t))}"><div class="row">${row(LCD_SCREENS[b.screen][0])}</div><div class="row">${row(LCD_SCREENS[b.screen][1])}</div></div>`,
    )
    .join("\n");
  const css = `
    #${id}-bg { position: absolute; inset: 0; background: ${PAPER}; }
    #${id}-pcb { position: absolute; left: 400px; top: 110px; width: 1120px; height: 500px; border-radius: 20px;
                 background: #1f6b3a; box-shadow: 0 30px 70px rgba(0,0,0,0.22); }
    #${id}-bezel { position: absolute; left: 470px; top: 170px; width: 980px; height: 380px; border-radius: 12px; background: #151515; }
    #${id}-glass { position: absolute; left: 510px; top: 210px; width: 900px; height: 300px; border-radius: 6px;
                   background: #2a52c9; box-shadow: inset 0 0 40px rgba(0,0,0,0.35); }
    .screen { position: absolute; left: 534px; top: 238px; }
    .row { display: flex; gap: 2px; margin-bottom: 18px; }
    .cell { width: ${cell}px; height: 104px; display: flex; align-items: center; justify-content: center;
            background: rgba(255,255,255,0.06); color: #f4f7ff; font-family: "JetBrains Mono", monospace;
            font-size: 64px; font-weight: 700; }
    #${id}-label { position: absolute; left: 400px; top: 640px; width: 1120px; text-align: center; font-size: 30px; font-weight: 700; color: #4b524a; }
  `;
  const cap = captions(id, beats, lang);
  const body = `<div id="${id}-bg"></div><div id="${id}-stage" class="fade" style="transform-origin:50% 35%"><div id="${id}-pcb"></div><div id="${id}-bezel"></div><div id="${id}-glass"></div>
    ${screens}</div>
    <div id="${id}-label">${esc(L("16×2 LCD on the coop unit · a new screen every 10 s", "16×2 LCD a ɛwɔ nkokɔ dan adwinnade no so · screen foforɔ sekan 10 biara")[lang])}</div>
    ${cap.html}`;
  const js = `tl.fromTo("#${id}-pcb, #${id}-bezel, #${id}-glass", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.05);
tl.fromTo("#${id}-stage", { scale: 1 }, { scale: 1.04, duration: ${r1(dur)}, ease: "none" }, 0);
${cap.js}`;
  return { dur, html: sceneFile(id, css, body, js, dur) };
}

// --- project -----------------------------------------------------------------------------------

function buildProject(guide, lang) {
  const dir = join(HERE, "build", `${guide.slug}-${lang}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "compositions"), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  // GSAP 3.14.2 from npm (videos/vendor), so renders never fetch from a CDN.
  copyFileSync(join(HERE, "vendor", "gsap-3.14.2.min.js"), join(dir, "assets", "gsap.min.js"));

  let t = 0;
  const hosts = [];
  guide.scenes.forEach((s, i) => {
    const id = `s${i}`;
    let r;
    if (s.type === "title") r = titleScene(id, s, lang, guide.kicker, i === 0);
    else if (s.type === "end") r = endScene(id, s, lang);
    else if (s.type === "shot") r = shotScene(id, s, lang);
    else if (s.type === "phone") r = phoneScene(id, s, lang);
    else if (s.type === "lcd") r = lcdScene(id, s, lang);
    else if (s.type === "brooder") r = diagramScene(id, s, lang, brooderParts(id, lang), brooderExtraJs(id));
    else if (s.type === "coop") r = diagramScene(id, s, lang, coopParts(id, lang), coopExtraJs(id, lang));
    else throw new Error(`Unknown scene type ${s.type}`);
    writeFileSync(join(dir, "compositions", `${id}.html`), r.html);
    for (const a of r.assets ?? []) copyFileSync(join(SHOTS, a), join(dir, "assets", a));
    hosts.push(
      `<div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${r1(t)}" data-duration="${r1(r.dur)}" data-track-index="1" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>`,
    );
    t += r.dur;
  });

  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html>
<html lang="${lang === "tw" ? "ak" : "en"}">
<head>
<meta charset="utf-8">
<title>PoultryGrid guide: ${guide.slug} (${lang})</title>
<script src="assets/gsap.min.js"></script>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${r1(t)}" data-width="${W}" data-height="${H}">
  <div id="paper" style="position:absolute;inset:0;background:${PAPER}"></div>
  ${hosts.join("\n  ")}
</div>
<script>
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = gsap.timeline({ paused: true });
</script>
</body>
</html>
`,
  );
  return { dir, duration: t };
}

function run(args, cwd) {
  return execFileSync("npx", [...HF, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 64 << 20 });
}

const argv = process.argv.slice(2);
const noRender = argv.includes("--no-render");
const [onlySlug, onlyLang] = argv.filter((a) => !a.startsWith("--"));
mkdirSync(OUT, { recursive: true });

for (const guide of GUIDES) {
  if (onlySlug && guide.slug !== onlySlug) continue;
  for (const lang of LANGS) {
    if (onlyLang && lang !== onlyLang) continue;
    const { dir, duration } = buildProject(guide, lang);
    console.log(`${guide.slug}-${lang}: ${duration.toFixed(1)} s → ${dir}`);
    if (noRender) continue;
    const mp4 = join(OUT, `${guide.slug}-${lang}.mp4`);
    run(["render", ".", "-o", mp4, "--crf", "30", "--quality", "standard", "--quiet", "--skill", "hyperframes"], dir);
    // Poster: the title card, once its text has landed.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "2.2", "-i", mp4, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", join(OUT, `${guide.slug}-${lang}.jpg`)]);
    console.log(`  ${(statSync(mp4).size / 1e6).toFixed(1)} MB`);
  }
}
if (!existsSync(join(OUT, "README.md"))) {
  writeFileSync(join(OUT, "README.md"), "Rendered by `node videos/build.mjs` from videos/guides.mjs. Don't edit by hand.\n");
}
