/**
 * Console theme engine (/app only).
 *
 * A theme is a palette family (Field, Coastal, Savanna, Kente, High contrast),
 * each with a light and a dark variant, plus personal overrides (accent,
 * background, fonts, size, density, corners, motion, sidebar). `computeTheme`
 * turns settings into the raw `--pg-*` CSS variables that src/styles.css
 * consumes; ThemeProvider writes them on <html> while the console is mounted.
 *
 * Accent shades are derived, not hand-picked: the brand colour is nudged in
 * lightness until white (light) or the page colour (dark) reads at WCAG AA
 * on it, and until it reads at AA on its own tint (active nav, badges).
 */

export type Mode = "light" | "dark" | "system";
export type Scheme = "light" | "dark";
export type FamilyId = "field" | "coastal" | "savanna" | "kente" | "contrast";
export type PresetId =
  | "field"
  | "night"
  | "coastal"
  | "midnight"
  | "savanna"
  | "kente"
  | "contrast";
export type FontId = "plex" | "inter" | "geist" | "manrope" | "source" | "atkinson";
export type MonoId = "plex-mono" | "jetbrains" | "geist-mono" | "source-code" | "same";
export type Background = "plain" | "texture" | "tint";
export type TextSize = "s" | "m" | "l" | "xl";
export type Density = "comfortable" | "compact";
export type Radius = "sharp" | "default" | "round";
export type Motion = "system" | "reduce";
export type SidebarStyle = "surface" | "blend" | "ink";
export type ClockFormat = "24h" | "12h";
export type TempUnitPref = "C" | "F";
export type Spacing = "normal" | "relaxed";
export type FocusStyle = "default" | "strong";
export type TargetSize = "default" | "large";
export type StatusColors = "default" | "cvd";
/** Language the farmer speaks to Ama in (see src/lib/ai-languages.ts). */

export interface ThemeSettings {
  v: 1;
  preset: PresetId;
  family: FamilyId;
  mode: Mode;
  /** Hex accent; null = the family's own accent. */
  accent: string | null;
  background: Background;
  sidebar: SidebarStyle;
  font: FontId;
  mono: MonoId;
  textSize: TextSize;
  density: Density;
  radius: Radius;
  motion: Motion;
  clock: ClockFormat;
  /** Display unit for temperatures; data and the DB stay in °C. */
  tempUnit: TempUnitPref;
  /* Accessibility */
  /** Taller lines and a little letter spacing for easier reading. */
  spacing: Spacing;
  underlineLinks: boolean;
  /** Thick, high-contrast focus ring for keyboard users. */
  focus: FocusStyle;
  /** 44px minimum for buttons and inputs, easier to tap. */
  targets: TargetSize;
  /** Show a still Ama instead of the animated GIF (WCAG 2.2.2). */
  stillImages: boolean;
  /** Blue / orange / purple status colours that work for red-green colour blindness. */
  statusColors: StatusColors;
  /** Ama reads her text-chat replies aloud. */
  aiSpeak: boolean;
}

/* -------------------------------------------------------------------------- *
 * Colour maths (sRGB, WCAG 2.x relative luminance)
 * -------------------------------------------------------------------------- */

type RGB = [number, number, number];

export function isHex(s: unknown): s is string {
  return typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s);
}

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: RGB) {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Mix `b` into `a` by weight w (0 = a, 1 = b). */
export function mix(a: string, b: string, w: number) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => A[i] * (1 - w) + B[i] * w) as RGB);
}

function toHsl(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: RGB) {
  if (s === 0) return rgbToHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex([f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]);
}

function shiftL(hex: string, dl: number) {
  const [h, s, l] = toHsl(hex);
  return fromHsl([h, s, Math.min(1, Math.max(0, l + dl))]);
}

/** Move lightness in `dir` until `ok` passes (or we hit black/white). */
function shiftUntil(hex: string, dir: 1 | -1, ok: (h: string) => boolean) {
  let h = hex;
  for (let i = 0; i < 60 && !ok(h); i++) h = shiftL(h, dir * 0.015);
  return h;
}

const rgbTriplet = (hex: string) => hexToRgb(hex).join(" ");

/* -------------------------------------------------------------------------- *
 * Palettes
 * -------------------------------------------------------------------------- */

interface Palette {
  paper: string;
  surface: string;
  sunken: string;
  hover: string;
  ink: string;
  ink2: string;
  ink3: string;
  inkDisabled: string;
  hairline: string;
  lineStrong: string;
  lineHover: string;
  accent: string;
  /** Fixed tint for the family's own accent (Kente's gold). */
  accentTint?: string;
  ochre: string;
  ochreTint: string;
  ok: string;
  okTint: string;
  warn: string;
  warnTint: string;
  crit: string;
  critTint: string;
  info: string;
  infoTint: string;
  offline: string;
  offlineTint: string;
  /** Series 2–4 (series 1 is the brand colour unless `chart1` is set). */
  chart: [string, string, string];
  chart1?: string;
  chartGrid: string;
}

const STATUS_LIGHT = {
  ochre: "#86600c",
  ochreTint: "#f6ecd6",
  ok: "#2a7047",
  okTint: "#e5f2e9",
  warn: "#96600f",
  warnTint: "#fbf0dc",
  crit: "#b42318",
  critTint: "#fbe7e5",
  info: "#2f6690",
  infoTint: "#e4eef6",
  offline: "#676d63",
  offlineTint: "#eeeeea",
};

/** Dark statuses: light foregrounds on deep tints, all ≥ 4.5:1 on their tint and the surface. */
const statusDark = (offlineTint: string) => ({
  ochre: "#dcab52",
  ochreTint: "#2f2614",
  ok: "#6cc490",
  okTint: "#14291c",
  warn: "#e2aa52",
  warnTint: "#30240f",
  crit: "#f2897e",
  critTint: "#3a1916",
  info: "#82b6e2",
  infoTint: "#142536",
  offline: "#a0a79b",
  offlineTint,
});

export const FAMILIES: Record<FamilyId, { name: string; light: Palette; dark: Palette }> = {
  field: {
    name: "Field",
    light: {
      paper: "#f5f4ef",
      surface: "#ffffff",
      sunken: "#eeece5",
      hover: "#f9f8f4",
      ink: "#1c211c",
      ink2: "#4b524a",
      ink3: "#656d63",
      inkDisabled: "#a3a89f",
      hairline: "#e4e1d7",
      lineStrong: "#cdc9bc",
      lineHover: "#b9b4a5",
      accent: "#2f5d3a",
      ...STATUS_LIGHT,
      chart: ["#b9821c", "#3e6a8a", "#9c4f2e"],
      chartGrid: "#ece9e0",
    },
    dark: {
      paper: "#121512",
      surface: "#191d19",
      sunken: "#232823",
      hover: "#1e231e",
      ink: "#e8ece5",
      ink2: "#bcc3b8",
      ink3: "#949d90",
      inkDisabled: "#5f685c",
      hairline: "#2b312b",
      lineStrong: "#3e463d",
      lineHover: "#566053",
      accent: "#86c49a",
      ...statusDark("#262b25"),
      chart: ["#dcab52", "#7faed4", "#de8f6b"],
      chartGrid: "#252b25",
    },
  },
  coastal: {
    name: "Coastal",
    light: {
      paper: "#f1f4f5",
      surface: "#ffffff",
      sunken: "#e6ebed",
      hover: "#f6f8f9",
      ink: "#132026",
      ink2: "#3d4b53",
      ink3: "#59676f",
      inkDisabled: "#99a4aa",
      hairline: "#dce3e6",
      lineStrong: "#c2cbd0",
      lineHover: "#a8b3b9",
      accent: "#0f5f73",
      ...STATUS_LIGHT,
      offline: "#5f6a70",
      offlineTint: "#eaeef0",
      chart: ["#bd8319", "#5a5f99", "#a4502f"],
      chartGrid: "#e7ecee",
    },
    dark: {
      paper: "#0d1316",
      surface: "#131b1f",
      sunken: "#1c262b",
      hover: "#172126",
      ink: "#e5edf0",
      ink2: "#b2c0c6",
      ink3: "#8a9aa2",
      inkDisabled: "#55636a",
      hairline: "#223036",
      lineStrong: "#344349",
      lineHover: "#4b5c63",
      accent: "#5ec2d6",
      ...statusDark("#1e272b"),
      chart: ["#dcab52", "#a0a6e0", "#de8f6b"],
      chartGrid: "#1d282d",
    },
  },
  savanna: {
    name: "Savanna",
    light: {
      paper: "#f6f1e6",
      surface: "#fffcf6",
      sunken: "#ede5d4",
      hover: "#faf6ed",
      ink: "#241d13",
      ink2: "#54483a",
      ink3: "#6c604d",
      inkDisabled: "#aa9e88",
      hairline: "#e5dbc6",
      lineStrong: "#cfc2a6",
      lineHover: "#b7a888",
      accent: "#8b4a1d",
      ...STATUS_LIGHT,
      offline: "#6a6458",
      offlineTint: "#efebe2",
      chart: ["#a87a12", "#3e6a8a", "#5f6b2a"],
      chartGrid: "#ece4d3",
    },
    dark: {
      paper: "#16120c",
      surface: "#1d1812",
      sunken: "#28221a",
      hover: "#221c15",
      ink: "#efe7d9",
      ink2: "#c6baa5",
      ink3: "#9e927d",
      inkDisabled: "#665c4c",
      hairline: "#312a20",
      lineStrong: "#463c2e",
      lineHover: "#5d503e",
      accent: "#e39a62",
      ...statusDark("#29241c"),
      chart: ["#d9b04e", "#7faed4", "#a9b56a"],
      chartGrid: "#2a241b",
    },
  },
  kente: {
    name: "Kente",
    light: {
      paper: "#f7f4eb",
      surface: "#ffffff",
      sunken: "#efe9da",
      hover: "#fbf9f2",
      ink: "#17130d",
      ink2: "#463e31",
      ink3: "#645a49",
      inkDisabled: "#a69c88",
      hairline: "#e6decb",
      lineStrong: "#cdc2a9",
      lineHover: "#b3a68a",
      accent: "#1c1812",
      accentTint: "#f4e3b0",
      ...STATUS_LIGHT,
      chart1: "#1f6b3a",
      chart: ["#bd8a12", "#a8321f", "#2f5f8a"],
      chartGrid: "#eee8d9",
    },
    dark: {
      paper: "#110f0b",
      surface: "#1a1711",
      sunken: "#252019",
      hover: "#1f1b14",
      ink: "#f3ecdd",
      ink2: "#cbc0ab",
      ink3: "#a0947e",
      inkDisabled: "#665c4b",
      hairline: "#2f2a20",
      lineStrong: "#443c2f",
      lineHover: "#5c5241",
      accent: "#e8bb4c",
      ...statusDark("#28241d"),
      chart1: "#6cc490",
      chart: ["#e8bb4c", "#f2897e", "#82b6e2"],
      chartGrid: "#29241b",
    },
  },
  contrast: {
    name: "High contrast",
    light: {
      paper: "#ffffff",
      surface: "#ffffff",
      sunken: "#efefef",
      hover: "#f5f5f5",
      ink: "#000000",
      ink2: "#1a1a1a",
      ink3: "#333333",
      inkDisabled: "#6b6b6b",
      hairline: "#767676",
      lineStrong: "#4d4d4d",
      lineHover: "#000000",
      accent: "#0b5a2c",
      ochre: "#7a5200",
      ochreTint: "#fbefd2",
      ok: "#0e5a2c",
      okTint: "#e1f2e6",
      warn: "#7a4500",
      warnTint: "#fdeccd",
      crit: "#a0120a",
      critTint: "#fde2df",
      info: "#124a7a",
      infoTint: "#e0ecf8",
      offline: "#3d3d3d",
      offlineTint: "#ececec",
      chart: ["#9a6400", "#124a7a", "#a0120a"],
      chartGrid: "#d6d6d6",
    },
    dark: {
      paper: "#000000",
      surface: "#0b0b0b",
      sunken: "#1c1c1c",
      hover: "#151515",
      ink: "#ffffff",
      ink2: "#ececec",
      ink3: "#c8c8c8",
      inkDisabled: "#909090",
      hairline: "#8c8c8c",
      lineStrong: "#b5b5b5",
      lineHover: "#ffffff",
      accent: "#7fe6a3",
      ochre: "#ffc85a",
      ochreTint: "#2e2208",
      ok: "#7fe6a3",
      okTint: "#0c2716",
      warn: "#ffc85a",
      warnTint: "#2e2208",
      crit: "#ff9d93",
      critTint: "#3a0f0b",
      info: "#9ccbff",
      infoTint: "#0c2236",
      offline: "#c8c8c8",
      offlineTint: "#222222",
      chart: ["#ffc85a", "#9ccbff", "#ff9d93"],
      chartGrid: "#333333",
    },
  },
};

/* -------------------------------------------------------------------------- *
 * Presets, accents, fonts
 * -------------------------------------------------------------------------- */

export interface Preset {
  id: PresetId;
  name: string;
  description: string;
  family: FamilyId;
  mode: Mode;
}

export const PRESETS: Preset[] = [
  {
    id: "field",
    name: "Field",
    description: "Warm paper, field green. The default.",
    family: "field",
    mode: "light",
  },
  {
    id: "night",
    name: "Night shift",
    description: "Dark charcoal for night checks in the house.",
    family: "field",
    mode: "dark",
  },
  {
    id: "coastal",
    name: "Coastal",
    description: "Cool grey-blue neutrals, deep sea teal.",
    family: "coastal",
    mode: "light",
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Cool blue-black with a lagoon accent.",
    family: "coastal",
    mode: "dark",
  },
  {
    id: "savanna",
    name: "Savanna",
    description: "Sand and dry grass, with a laterite brown.",
    family: "savanna",
    mode: "light",
  },
  {
    id: "kente",
    name: "Kente",
    description: "Ivory and black, with kente gold highlights.",
    family: "kente",
    mode: "light",
  },
  {
    id: "contrast",
    name: "High contrast",
    description: "Black on white, strong borders. Best outdoors.",
    family: "contrast",
    mode: "light",
  },
];

export const ACCENTS: { name: string; hex: string }[] = [
  { name: "Field green", hex: "#2f5d3a" },
  { name: "Cocoa", hex: "#6b4226" },
  { name: "Laterite", hex: "#9a4a22" },
  { name: "Kente gold", hex: "#8a6a10" },
  { name: "Lagoon teal", hex: "#0f6670" },
  { name: "Volta blue", hex: "#24578f" },
  { name: "Slate", hex: "#46525e" },
  { name: "Charcoal", hex: "#26282b" },
];

const SANS_FALLBACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO_FALLBACK = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

export const FONTS: Record<FontId, { name: string; family: string; css?: string; note: string }> = {
  plex: {
    name: "IBM Plex Sans",
    family: "IBM Plex Sans",
    note: "Default. Technical, warm.",
  },
  inter: {
    name: "Inter",
    family: "Inter",
    css: "Inter:wght@400;500;600",
    note: "Neutral, compact.",
  },
  geist: {
    name: "Geist",
    family: "Geist",
    css: "Geist:wght@400;500;600",
    note: "Crisp, geometric.",
  },
  manrope: {
    name: "Manrope",
    family: "Manrope",
    css: "Manrope:wght@400;500;600",
    note: "Rounded, friendly.",
  },
  source: {
    name: "Source Sans 3",
    family: "Source Sans 3",
    css: "Source+Sans+3:wght@400;500;600",
    note: "Open, easy on long lists.",
  },
  atkinson: {
    name: "Atkinson Hyperlegible",
    family: "Atkinson Hyperlegible Next",
    css: "Atkinson+Hyperlegible+Next:wght@400;500;600",
    note: "Most legible. Distinct letterforms.",
  },
};

export const MONO_FONTS: Record<MonoId, { name: string; family: string | null; css?: string }> = {
  "plex-mono": { name: "IBM Plex Mono", family: "IBM Plex Mono" },
  jetbrains: {
    name: "JetBrains Mono",
    family: "JetBrains Mono",
    css: "JetBrains+Mono:wght@400;500",
  },
  "geist-mono": { name: "Geist Mono", family: "Geist Mono", css: "Geist+Mono:wght@400;500" },
  "source-code": {
    name: "Source Code Pro",
    family: "Source Code Pro",
    css: "Source+Code+Pro:wght@400;500",
  },
  same: { name: "Same as interface", family: null },
};

export const fontUrl = (css: string, text?: string) =>
  `https://fonts.googleapis.com/css2?family=${css}&display=swap${text ? `&text=${encodeURIComponent(text)}` : ""}`;

export const TEXT_ZOOM: Record<TextSize, number> = { s: 13 / 14, m: 1, l: 16 / 14, xl: 18 / 14 };
const RADIUS_PX: Record<Radius, number> = { sharp: 4, default: 8, round: 12 };

export const DEFAULT_SETTINGS: ThemeSettings = {
  v: 1,
  preset: "field",
  family: "field",
  mode: "light",
  accent: null,
  background: "plain",
  sidebar: "surface",
  font: "plex",
  mono: "plex-mono",
  textSize: "m",
  density: "comfortable",
  radius: "default",
  motion: "system",
  clock: "24h",
  tempUnit: "C",
  spacing: "normal",
  underlineLinks: false,
  focus: "default",
  targets: "default",
  stillImages: false,
  statusColors: "default",
  aiSpeak: false,
};

/** Settings a preset owns (colour); everything else is personal and survives preset changes. */
export function presetSettings(
  id: PresetId,
): Pick<ThemeSettings, "preset" | "family" | "mode" | "accent" | "background"> {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return { preset: p.id, family: p.family, mode: p.mode, accent: null, background: "plain" };
}

export function isCustomised(s: ThemeSettings) {
  const p = presetSettings(s.preset);
  return (
    s.family !== p.family ||
    s.mode !== p.mode ||
    s.accent !== p.accent ||
    s.background !== p.background
  );
}

/** Coerce anything read from storage into valid settings. */
export function sanitize(raw: unknown): ThemeSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
    allowed.includes(v as T) ? (v as T) : d;
  const d = DEFAULT_SETTINGS;
  return {
    v: 1,
    preset: pick(
      r.preset,
      PRESETS.map((p) => p.id),
      d.preset,
    ),
    family: pick(r.family, Object.keys(FAMILIES) as FamilyId[], d.family),
    mode: pick(r.mode, ["light", "dark", "system"] as const, d.mode),
    accent: isHex(r.accent) ? r.accent.toLowerCase() : null,
    background: pick(r.background, ["plain", "texture", "tint"] as const, d.background),
    sidebar: pick(r.sidebar, ["surface", "blend", "ink"] as const, d.sidebar),
    font: pick(r.font, Object.keys(FONTS) as FontId[], d.font),
    mono: pick(r.mono, Object.keys(MONO_FONTS) as MonoId[], d.mono),
    textSize: pick(r.textSize, ["s", "m", "l", "xl"] as const, d.textSize),
    density: pick(r.density, ["comfortable", "compact"] as const, d.density),
    radius: pick(r.radius, ["sharp", "default", "round"] as const, d.radius),
    motion: pick(r.motion, ["system", "reduce"] as const, d.motion),
    clock: pick(r.clock, ["24h", "12h"] as const, d.clock),
    tempUnit: pick(r.tempUnit, ["C", "F"] as const, d.tempUnit),
    spacing: pick(r.spacing, ["normal", "relaxed"] as const, d.spacing),
    underlineLinks: typeof r.underlineLinks === "boolean" ? r.underlineLinks : d.underlineLinks,
    focus: pick(r.focus, ["default", "strong"] as const, d.focus),
    targets: pick(r.targets, ["default", "large"] as const, d.targets),
    stillImages: typeof r.stillImages === "boolean" ? r.stillImages : d.stillImages,
    statusColors: pick(r.statusColors, ["default", "cvd"] as const, d.statusColors),
    aiSpeak: typeof r.aiSpeak === "boolean" ? r.aiSpeak : d.aiSpeak,
  };
}

/* -------------------------------------------------------------------------- *
 * Compute: settings -> CSS variables + attributes
 * -------------------------------------------------------------------------- */

export interface ComputedTheme {
  scheme: Scheme;
  vars: Record<string, string>;
  attrs: Record<string, string>;
  fonts: string[];
  themeColor: string;
}

interface BrandSet {
  brand: string;
  hover: string;
  tint: string;
  onBrand: string;
}

/** Derive brand / hover / tint / on-brand from any accent, AA-safe for the palette. */
export function deriveBrand(
  accent: string,
  pal: Palette,
  scheme: Scheme,
  fixedTint?: string,
): BrandSet {
  if (scheme === "light") {
    const tintOf = (b: string) => fixedTint ?? mix(b, pal.surface, 0.9);
    const brand = shiftUntil(
      accent,
      -1,
      (b) =>
        contrast(b, "#ffffff") >= 4.6 &&
        contrast(b, tintOf(b)) >= 4.6 &&
        contrast(b, pal.paper) >= 4.6,
    );
    const hover = shiftL(brand, luminance(brand) < 0.02 ? 0.07 : -0.06);
    return { brand, hover, tint: tintOf(brand), onBrand: "#ffffff" };
  }
  const tintOf = (b: string) => mix(b, pal.surface, 0.84);
  const brand = shiftUntil(
    accent,
    1,
    (b) =>
      contrast(b, pal.surface) >= 4.6 &&
      contrast(b, tintOf(b)) >= 4.6 &&
      contrast(b, pal.paper) >= 4.6,
  );
  return { brand, hover: shiftL(brand, 0.06), tint: tintOf(brand), onBrand: pal.paper };
}

export function resolveScheme(mode: Mode, prefersDark: boolean): Scheme {
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}

const arrowSvg = (stroke: string) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(stroke)}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

/** Palette-only vars (used by both the live theme and the preset previews). */
export function paletteVars(
  family: FamilyId,
  scheme: Scheme,
  accent: string | null,
  background: Background = "plain",
): Record<string, string> {
  const pal = FAMILIES[family][scheme];
  const useFamilyAccent = !accent;
  const b = deriveBrand(
    accent ?? pal.accent,
    pal,
    scheme,
    useFamilyAccent ? pal.accentTint : undefined,
  );
  const paper =
    background === "tint" ? mix(pal.paper, b.brand, scheme === "light" ? 0.035 : 0.045) : pal.paper;
  const inkRgb = rgbTriplet(pal.ink);
  const chart1 = useFamilyAccent && pal.chart1 ? pal.chart1 : b.brand;
  return {
    "--pg-paper": paper,
    "--pg-surface": pal.surface,
    "--pg-sunken": pal.sunken,
    "--pg-hover": pal.hover,
    "--pg-ink": pal.ink,
    "--pg-ink-2": pal.ink2,
    "--pg-ink-3": pal.ink3,
    "--pg-ink-disabled": pal.inkDisabled,
    "--pg-hairline": pal.hairline,
    "--pg-line-strong": pal.lineStrong,
    "--pg-line-hover": pal.lineHover,
    "--pg-focus": b.brand,
    "--pg-brand": b.brand,
    "--pg-brand-hover": b.hover,
    "--pg-brand-tint": b.tint,
    "--pg-on-brand": b.onBrand,
    "--pg-on-crit": scheme === "light" ? "#ffffff" : pal.paper,
    "--pg-accent-bg": mix(pal.hover, pal.sunken, 0.5),
    "--pg-ochre": pal.ochre,
    "--pg-ochre-tint": pal.ochreTint,
    "--pg-ok": pal.ok,
    "--pg-ok-tint": pal.okTint,
    "--pg-warn": pal.warn,
    "--pg-warn-tint": pal.warnTint,
    "--pg-crit": pal.crit,
    "--pg-crit-tint": pal.critTint,
    "--pg-info": pal.info,
    "--pg-info-tint": pal.infoTint,
    "--pg-offline": pal.offline,
    "--pg-offline-tint": pal.offlineTint,
    "--pg-chart-1": chart1,
    "--pg-chart-2": pal.chart[0],
    "--pg-chart-3": pal.chart[1],
    "--pg-chart-4": pal.chart[2],
    "--pg-chart-grid": pal.chartGrid,
    "--pg-chart-target": chart1,
    "--pg-skel-hi": mix(pal.sunken, pal.surface, 0.55),
    "--pg-select-arrow": arrowSvg(pal.ink3),
    "--pg-shadow-pop":
      scheme === "light"
        ? `0 1px 2px rgb(${inkRgb} / 0.06), 0 8px 24px rgb(${inkRgb} / 0.08)`
        : "0 1px 2px rgb(0 0 0 / 0.5), 0 10px 28px rgb(0 0 0 / 0.5)",
    "--pg-shadow-xs":
      scheme === "light" ? `0 1px 0 rgb(${inkRgb} / 0.04)` : "0 1px 0 rgb(0 0 0 / 0.3)",
    "--pg-overlay": scheme === "light" ? `rgb(${inkRgb} / 0.36)` : "rgb(0 0 0 / 0.62)",
    "--pg-color-scheme": scheme,
  };
}

const SIDEBAR_KEYS = [
  ["surface", "--pg-surface"],
  ["sunken", "--pg-sunken"],
  ["ink", "--pg-ink"],
  ["ink2", "--pg-ink-2"],
  ["ink3", "--pg-ink-3"],
  ["disabled", "--pg-ink-disabled"],
  ["hairline", "--pg-hairline"],
  ["brand", "--pg-brand"],
  ["brand-tint", "--pg-brand-tint"],
  ["on-brand", "--pg-on-brand"],
  ["crit", "--pg-crit"],
  ["crit-tint", "--pg-crit-tint"],
  ["focus", "--pg-focus"],
] as const;

export function computeTheme(s: ThemeSettings, prefersDark: boolean): ComputedTheme {
  const scheme = resolveScheme(s.mode, prefersDark);
  const vars = paletteVars(s.family, scheme, s.accent, s.background);

  // "Ink" sidebar: the family's dark palette scoped to the sidebar.
  if (s.sidebar === "ink") {
    const dark = paletteVars(s.family, "dark", s.accent);
    const deeper = scheme === "dark" ? FAMILIES[s.family].dark.paper : dark["--pg-surface"];
    for (const [k, src] of SIDEBAR_KEYS) {
      vars[`--pg-sb-${k}`] = k === "surface" ? deeper : dark[src];
    }
  }

  const font = FONTS[s.font];
  const mono = MONO_FONTS[s.mono];
  const sans = `"${font.family}", ${s.font === "plex" ? "" : '"IBM Plex Sans", '}${SANS_FALLBACK}`;
  vars["--pg-font-sans"] = sans;
  vars["--pg-font-mono"] = mono.family ? `"${mono.family}", ${MONO_FALLBACK}` : sans;
  vars["--pg-zoom"] = String(TEXT_ZOOM[s.textSize]);
  vars["--pg-radius"] = `${RADIUS_PX[s.radius]}px`;

  // Colour-blind-safe status colours (Okabe-Ito inspired): blue = fine, orange = warning,
  // reddish purple = critical. Each passes AA on its tint.
  if (s.statusColors === "cvd") {
    const light = scheme === "light";
    Object.assign(vars, {
      "--pg-ok": light ? "#0b5ea8" : "#71b5ee",
      "--pg-ok-tint": light ? "#e3eef9" : "#132a3e",
      "--pg-warn": light ? "#8f5300" : "#eda552",
      "--pg-warn-tint": light ? "#fcefdc" : "#35260f",
      "--pg-crit": light ? "#9c1b62" : "#f08cc0",
      "--pg-crit-tint": light ? "#f9e3ef" : "#3c1429",
      "--pg-on-crit": light ? "#ffffff" : FAMILIES[s.family].dark.paper,
    });
  }

  const fonts: string[] = [];
  if (font.css) fonts.push(fontUrl(font.css));
  if (mono.css) fonts.push(fontUrl(mono.css));

  return {
    scheme,
    vars,
    attrs: {
      "data-pg-scheme": scheme,
      "data-pg-bg": s.background,
      "data-pg-density": s.density,
      "data-pg-radius": s.radius,
      "data-pg-motion": s.motion,
      "data-pg-sidebar": s.sidebar,
      "data-pg-spacing": s.spacing,
      "data-pg-underline": s.underlineLinks ? "on" : "off",
      "data-pg-focus": s.focus,
      "data-pg-targets": s.targets,
      "data-pg-still": s.stillImages ? "on" : "off",
      "data-pg-status": s.statusColors,
    },
    fonts,
    themeColor: vars["--pg-paper"],
  };
}

/* -------------------------------------------------------------------------- *
 * DOM application + storage
 * -------------------------------------------------------------------------- */

export const STORAGE_PREFIX = "pg-theme:v1:";
export const BOOT_KEY = `${STORAGE_PREFIX}boot`;
export const userKey = (id: string) => `${STORAGE_PREFIX}u:${id}`;

export function readJSON(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the theme still applies for this session */
  }
}

/** Snapshot the boot script can apply without running the engine. */
export interface BootSnapshot {
  mode: Mode;
  light: ComputedTheme;
  dark: ComputedTheme;
}

export function bootSnapshot(s: ThemeSettings): BootSnapshot {
  return { mode: s.mode, light: computeTheme(s, false), dark: computeTheme(s, true) };
}

const applied = { vars: new Set<string>(), attrs: new Set<string>() };

export function ensureFontLink(href: string) {
  if (typeof document === "undefined") return;
  if (document.head.querySelector(`link[data-pg-font][href="${CSS.escape(href)}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  l.setAttribute("data-pg-font", "");
  document.head.appendChild(l);
}

function themeMeta() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.setAttribute("data-pg-created", "");
    document.head.appendChild(meta);
  }
  return meta;
}

export function applyTheme(t: ComputedTheme) {
  const root = document.documentElement;
  root.classList.add("pg-console");
  for (const k of applied.vars) if (!(k in t.vars)) root.style.removeProperty(k);
  applied.vars.clear();
  for (const [k, v] of Object.entries(t.vars)) {
    root.style.setProperty(k, v);
    applied.vars.add(k);
  }
  for (const [k, v] of Object.entries(t.attrs)) {
    root.setAttribute(k, v);
    applied.attrs.add(k);
  }
  t.fonts.forEach(ensureFontLink);
  const meta = themeMeta();
  if (!meta.hasAttribute("data-pg-prev")) meta.setAttribute("data-pg-prev", meta.content || "");
  meta.content = t.themeColor;
}

/** Undo everything applyTheme (and the boot script) did: the landing page is untouched. */
export function clearTheme() {
  const root = document.documentElement;
  root.classList.remove("pg-console");
  const props: string[] = [];
  for (let i = 0; i < root.style.length; i++) props.push(root.style[i]);
  for (const p of props)
    if (p.startsWith("--pg-") || p === "--radius") root.style.removeProperty(p);
  for (const a of Array.from(root.attributes))
    if (a.name.startsWith("data-pg-")) root.removeAttribute(a.name);
  if (!root.getAttribute("style")) root.removeAttribute("style");
  applied.vars.clear();
  applied.attrs.clear();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta?.hasAttribute("data-pg-created")) meta.remove();
  else if (meta?.hasAttribute("data-pg-prev")) {
    meta.content = meta.getAttribute("data-pg-prev") ?? "";
    meta.removeAttribute("data-pg-prev");
  }
}

/**
 * Inline script for the SSR'd console: applies the last snapshot before the
 * first paint so a dark theme never flashes light. Must stay self-contained.
 */
export const BOOT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(
  BOOT_KEY,
)})||"null");var r=document.documentElement;if(!s)return;var d=s.mode==="system"?matchMedia("(prefers-color-scheme: dark)").matches:s.mode==="dark";var t=d?s.dark:s.light;for(var k in t.vars)r.style.setProperty(k,t.vars[k]);for(var a in t.attrs)r.setAttribute(a,t.attrs[a]);t.fonts.forEach(function(h){var l=document.createElement("link");l.rel="stylesheet";l.href=h;l.setAttribute("data-pg-font","");document.head.appendChild(l)});var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.name="theme-color";m.setAttribute("data-pg-created","");document.head.appendChild(m)}else if(!m.hasAttribute("data-pg-prev"))m.setAttribute("data-pg-prev",m.content||"");m.content=t.themeColor}catch(e){}})();`;

/* -------------------------------------------------------------------------- *
 * Avatar colour (stable per user)
 * -------------------------------------------------------------------------- */

const AVATAR_HUES = [
  "#2f6b45",
  "#2f6690",
  "#8b4a1d",
  "#8a6a10",
  "#0f6670",
  "#6b4226",
  "#46525e",
  "#7a3b52",
];

/** A stable hue per id; render with color-mix so it adapts to light and dark themes. */
export function avatarHue(id: string | null | undefined) {
  let h = 0;
  for (const c of id ?? "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

export function initialsOf(name: string) {
  return (
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0])
      .join("")
      .toUpperCase() || "U"
  );
}
