/**
 * PoultryGrid console UI kit ("Field instrument").
 * Shared building blocks for every /app page. Styling comes from tokens in
 * src/styles.css (--pg-*, Tailwind colours like bg-surface / text-ink-3 /
 * border-hairline) and component classes (.pg-btn, .pg-input, .pg-table ...).
 * See scratchpad design-system.md for the catalogue and usage rules.
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Loader2,
  Lock,
  Minus,
  RotateCw,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FRESHNESS_MS } from "@/lib/api/types";

/* ========================================================================== *
 * Status vocabulary
 * ========================================================================== */

/** Semantic state. Never colour-only: every visual carries a word too. */
export type Status = "ok" | "warn" | "crit" | "info" | "offline" | "neutral" | "brand";
/** Legacy tone names (kept for existing pages). */
export type Tone = "default" | "success" | "warning" | "destructive" | "info" | "brand" | "offline";

export const toneToStatus: Record<Tone, Status> = {
  default: "neutral",
  success: "ok",
  warning: "warn",
  destructive: "crit",
  info: "info",
  brand: "brand",
  offline: "offline",
};

/** Text + tint classes per status (pill / badge backgrounds). */
export const statusClass: Record<Status, string> = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  crit: "bg-crit-tint text-crit",
  info: "bg-info-tint text-info",
  offline: "bg-offline-tint text-offline",
  neutral: "bg-sunken text-ink-2",
  brand: "bg-brand-tint text-brand",
};

/** Foreground-only colour per status (dots, inline text). */
export const statusText: Record<Status, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  info: "text-info",
  offline: "text-offline",
  neutral: "text-ink-3",
  brand: "text-brand",
};

/* ========================================================================== *
 * Formatting (en-GB: "3 Oct 2026, 23:20" — never ambiguous 03/10/2026)
 * ========================================================================== */

const LOCALE = "en-GB";

export function formatNumber(
  n: number | null | undefined,
  opts: Intl.NumberFormatOptions = { maximumFractionDigits: 1 },
) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(LOCALE, opts).format(n);
}

export function formatDate(iso: string | number | Date | null | undefined) {
  if (iso == null) return "—";
  return new Date(iso).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* -------------------------------------------------------------------------- *
 * Display preferences (profile page): clock format and temperature unit.
 * A tiny external store so components re-render when either changes. Pages
 * and components that format times or temperatures call useDisplayPrefs()
 * (or useTempUnit()) once at the top; the formatters below read the store.
 * -------------------------------------------------------------------------- */

export type TempUnit = "C" | "F";
type DisplayPrefs = { clock: "24h" | "12h"; tempUnit: TempUnit };

let prefs: DisplayPrefs = { clock: "24h", tempUnit: "C" };
const prefListeners = new Set<() => void>();
const SERVER_PREFS: DisplayPrefs = { clock: "24h", tempUnit: "C" };

function setPrefs(patch: Partial<DisplayPrefs>) {
  const next = { ...prefs, ...patch };
  if (next.clock === prefs.clock && next.tempUnit === prefs.tempUnit) return;
  prefs = next;
  prefListeners.forEach((l) => l());
}

function subscribePrefs(cb: () => void) {
  prefListeners.add(cb);
  return () => {
    prefListeners.delete(cb);
  };
}

/** Subscribe to clock + temperature preferences; re-renders the caller when either changes. */
export function useDisplayPrefs(): DisplayPrefs {
  return React.useSyncExternalStore(
    subscribePrefs,
    () => prefs,
    () => SERVER_PREFS,
  );
}

/** Current temperature unit ("C" | "F"); re-renders the caller when it changes. */
export function useTempUnit(): TempUnit {
  return useDisplayPrefs().tempUnit;
}

/** Console clock preference (profile page). Every time in the console goes through formatTime. */
export function setClockFormat(format: "24h" | "12h") {
  setPrefs({ clock: format });
}

/** Console temperature unit (profile page). Data and the DB stay in °C; only display converts. */
export function setTempUnit(unit: TempUnit) {
  setPrefs({ tempUnit: unit });
}

/** Absolute temperature: stored °C -> display unit. null/NaN pass through as null. */
export function toTemp(c: number | null | undefined): number | null {
  // Numeric DB columns can arrive as strings; coerce.
  const n = Number(c);
  if (c == null || !Number.isFinite(n)) return null;
  return prefs.tempUnit === "F" ? (n * 9) / 5 + 32 : n;
}

/** Temperature difference (deltas, bands, ±tolerances): °C -> display unit, no offset. */
export function toTempDelta(dc: number | null | undefined): number | null {
  // Numeric DB columns can arrive as strings; coerce.
  const n = Number(dc);
  if (dc == null || !Number.isFinite(n)) return null;
  return prefs.tempUnit === "F" ? (n * 9) / 5 : n;
}

/** Display unit entered by the user -> °C for storage. */
export function fromTemp(v: number | null | undefined): number | null {
  const n = Number(v);
  if (v == null || !Number.isFinite(n)) return null;
  return prefs.tempUnit === "F" ? ((n - 32) * 5) / 9 : n;
}

/** "°C" or "°F". */
export function tempUnit() {
  return prefs.tempUnit === "F" ? "°F" : "°C";
}

/** "28.2 °C" / "82.8 °F" from a stored °C value. null -> "—". */
export function formatTemp(c: number | null | undefined, digits = 1) {
  return formatUnit(toTemp(c), tempUnit(), digits);
}

/** "+6.2 °C" / "+11.2 °F" from a °C difference (signed; U+2212 minus). null -> "—". */
export function formatTempDelta(dc: number | null | undefined, digits = 1) {
  const d = toTempDelta(dc);
  if (d == null) return "—";
  const r = +d.toFixed(digits);
  const sign = r > 0 ? "+" : r < 0 ? "−" : "±";
  return `${sign}${formatNumber(Math.abs(r), { maximumFractionDigits: digits })}${NBSP}${tempUnit()}`;
}

export function formatTime(iso: string | number | Date | null | undefined) {
  if (iso == null) return "—";
  return new Date(iso).toLocaleTimeString(
    LOCALE,
    prefs.clock === "12h"
      ? { hour: "numeric", minute: "2-digit", hour12: true }
      : { hour: "2-digit", minute: "2-digit" },
  );
}

export function formatDateTime(iso: string | number | Date | null | undefined) {
  if (iso == null) return "—";
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

/** "just now", "42 s ago", "5 min ago", "3 h ago", "2 d ago", "3 wk ago", "7 mo ago", "1 y ago". */
export function formatRelative(iso: string | number | Date | null | undefined, now = Date.now()) {
  if (iso == null) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(s / 3600);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(s / 86400);
  if (d < 14) return `${d} d ago`;
  if (d < 60) return `${Math.round(d / 7)} wk ago`;
  if (d < 365) return `${Math.round(d / 30)} mo ago`;
  return `${Math.round(d / 365)} y ago`;
}

/* -------------------------------------------------------------------------- *
 * Units: one format everywhere -> number, NBSP, unit ("65.8 % RH", "28.2 °C")
 * -------------------------------------------------------------------------- */

const NBSP = String.fromCharCode(160);

/** Canonical unit strings. Humidity is always "% RH". */
export const UNITS = {
  /** Display temperature unit ("°C" / "°F"). Format values with formatTemp, never formatUnit. */
  get temp() {
    return tempUnit();
  },
  rh: "% RH",
  pct: "%",
  w: "W",
  kwh: "kWh",
  m3: "m³",
  kg: "kg",
  birds: "birds",
};

/**
 * "65.8 % RH", "28.2 °C", "40 %". null/NaN -> "—" (no unit).
 * `digits` = max fraction digits (default 1). Pass a number, never a pre-formatted string.
 */
export function formatUnit(
  value: number | null | undefined,
  unit?: string,
  digits: number | Intl.NumberFormatOptions = 1,
) {
  if (value == null || Number.isNaN(value)) return "—";
  const opts = typeof digits === "number" ? { maximumFractionDigits: digits } : digits;
  const n = formatNumber(value, opts);
  return unit ? `${n}${NBSP}${unit}` : n;
}

/**
 * JSX twin of formatUnit for inline figures: tabular sans number + small muted unit.
 * <Quantity value={65.8} unit={UNITS.rh} />. null -> muted "—".
 */
export function Quantity({
  value,
  unit,
  digits = 1,
  className,
}: {
  value: number | null | undefined;
  unit?: string;
  digits?: number;
  className?: string;
}) {
  if (value == null || Number.isNaN(value))
    return <span className={cn("pg-num text-ink-3", className)}>—</span>;
  return (
    <span className={cn("pg-num whitespace-nowrap", className)}>
      {formatNumber(value, { maximumFractionDigits: digits })}
      {unit && (
        <span className="text-ink-3">
          {NBSP}
          {unit}
        </span>
      )}
    </span>
  );
}

/** Fan wording used everywhere. The fan is on a relay: "On", "Off" or "—". */
export function formatFan(on: boolean | string | null | undefined) {
  if (on == null) return "—";
  return on === true || on === "on" ? "On" : "Off";
}

/** LDR wording: the level is relative (0 dark .. 50 bright), so say what it means. */
export function formatLight(level: number | null | undefined) {
  if (level == null || Number.isNaN(level)) return "—";
  if (level < 8) return "Dark";
  if (level < 20) return "Dim";
  return "Bright";
}

/* -------------------------------------------------------------------------- *
 * Freshness: the ONE staleness vocabulary. Thresholds: FRESHNESS_MS (types.ts)
 *   live     age < 90 s      "Live"                    pill green, pulsing dot
 *   delayed  age < 5 min     "Delayed · 3 min ago"     pill ochre
 *   stale    older           "Last seen 2 wk ago"      pill grey (offline)
 *   none     no timestamp    "No data yet"             pill grey
 * State words for old data use lastKnown(): "Warning · last known" (grey pill).
 * -------------------------------------------------------------------------- */

export type FreshnessState = "live" | "delayed" | "stale" | "none";

export interface FreshnessInfo {
  state: FreshnessState;
  /** StatusPill status for this state: ok | warn | offline. */
  status: Status;
  /** ms since `at`, or null. */
  age: number | null;
  /** formatRelative(at): "3 min ago" ("never" when none). */
  rel: string;
  /** Pill text: "Live" | "Delayed · 3 min ago" | "Last seen 2 wk ago" | "No data yet". */
  label: string;
  /** Tight pill text (phone top bar): "Live" | "Delayed · 3 min" | "Stale · 2 wk" | "No data". */
  short: string;
  /** Caption text: "Updated 12 s ago" (live) | "Last seen 3 min ago" | "No data yet". */
  caption: string;
  /** true for delayed/stale/none: don't paint values in live status colours. */
  isOld: boolean;
}

export function freshness(
  at: string | number | Date | null | undefined,
  now: number = Date.now(),
): FreshnessInfo {
  const t = at == null ? NaN : new Date(at).getTime();
  if (Number.isNaN(t)) {
    return {
      state: "none",
      status: "offline",
      age: null,
      rel: "never",
      label: "No data yet",
      short: "No data",
      caption: "No data yet",
      isOld: true,
    };
  }
  const age = Math.max(0, now - t);
  const rel = formatRelative(t, now);
  const bare = rel.replace(/ ago$/, "");
  if (age < FRESHNESS_MS.live)
    return {
      state: "live",
      status: "ok",
      age,
      rel,
      label: "Live",
      short: "Live",
      caption: `Updated ${rel}`,
      isOld: false,
    };
  if (age < FRESHNESS_MS.delayed)
    return {
      state: "delayed",
      status: "warn",
      age,
      rel,
      label: `Delayed · ${rel}`,
      short: `Delayed · ${bare}`,
      caption: `Last seen ${rel}`,
      isOld: true,
    };
  return {
    state: "stale",
    status: "offline",
    age,
    rel,
    label: `Last seen ${rel}`,
    short: `Stale · ${bare}`,
    caption: `Last seen ${rel}`,
    isOld: true,
  };
}

/** "Warning" -> "Warning · last known". Use with <StatusPill status="offline">. */
export function lastKnown(word: string) {
  return `${word} · last known`;
}

/**
 * Freshness of a timestamp in the one vocabulary. Ticks every 15 s.
 * variant "pill" (default): StatusPill. "caption": <time> text like "Last seen 2 wk ago".
 * "short": tight pill for cramped spots. Full date on hover in every variant.
 */
export function Freshness({
  at,
  variant = "pill",
  size = "md",
  className,
}: {
  at: string | number | Date | null | undefined;
  variant?: "pill" | "caption" | "short";
  size?: "sm" | "md";
  className?: string;
}) {
  const now = useNow(15_000);
  const f = freshness(at, now);
  const title = at != null && f.state !== "none" ? formatDateTime(at) : undefined;
  if (variant === "caption") {
    return f.state === "none" ? (
      <span className={cn("pg-t-caption", className)}>{f.caption}</span>
    ) : (
      <time
        dateTime={new Date(at!).toISOString()}
        title={title}
        className={cn("pg-t-caption", className)}
      >
        {f.caption}
      </time>
    );
  }
  return (
    <StatusPill
      status={f.status}
      size={size}
      pulse={f.state === "live"}
      title={title}
      className={className}
    >
      {variant === "short" ? f.short : f.label}
    </StatusPill>
  );
}

/** Re-renders every `intervalMs` so relative times stay true (and when display prefs change). */
export function useNow(intervalMs = 15_000) {
  useDisplayPrefs();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** <time> with relative text and the full date on hover. */
export function RelativeTime({
  iso,
  prefix,
  className,
}: {
  iso: string | null | undefined;
  prefix?: string;
  className?: string;
}) {
  const now = useNow(15_000);
  if (!iso) return <span className={className}>{prefix ? `${prefix} never` : "Never"}</span>;
  return (
    <time dateTime={new Date(iso).toISOString()} title={formatDateTime(iso)} className={className}>
      {prefix ? `${prefix} ` : ""}
      {formatRelative(iso, now)}
    </time>
  );
}

/**
 * Flicker-free loading flag: becomes true only after `delay` ms of `active`,
 * then stays true for at least `min` ms.
 */
export function useDelayedFlag(active: boolean, delay = 150, min = 300) {
  const [shown, setShown] = React.useState(false);
  const since = React.useRef(0);
  React.useEffect(() => {
    if (active) {
      const t = setTimeout(() => {
        since.current = Date.now();
        setShown(true);
      }, delay);
      return () => clearTimeout(t);
    }
    if (!shown) return;
    const left = Math.max(0, min - (Date.now() - since.current));
    const t = setTimeout(() => setShown(false), left);
    return () => clearTimeout(t);
  }, [active, delay, min, shown]);
  return shown;
}

/* ========================================================================== *
 * Page structure
 * ========================================================================== */

export function PageHeader({
  title,
  description,
  eyebrow,
  meta,
  children,
  className,
}: {
  title: string;
  /** One short factual line. Skip marketing subtitles. */
  description?: ReactNode;
  /** Tiny mono label above the title, e.g. "House 2". */
  eyebrow?: ReactNode;
  /** Caption row under the title: counts, last updated, etc. */
  meta?: ReactNode;
  /** Page actions (right side; wraps under the title on phone). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 md:mb-8",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <div className="pg-t-micro mb-1">{eyebrow}</div>}
        <h1 className="pg-t-title text-balance">{title}</h1>
        {description && (
          <p className="mt-1 max-w-[68ch] text-[14px] leading-5 text-ink-3">{description}</p>
        )}
        {meta && (
          <div className="pg-t-caption mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {meta}
          </div>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/** A titled page region. Use instead of wrapping everything in Cards. */
export function Section({
  title,
  description,
  action,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const auto = React.useId();
  const hid = `${id ?? auto}-h`;
  return (
    <section
      id={id}
      aria-labelledby={title ? hid : undefined}
      className={cn("scroll-mt-20", className)}
    >
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title && (
              <h2 id={hid} className="pg-t-h2">
                {title}
              </h2>
            )}
            {description && <p className="pg-t-caption mt-0.5">{description}</p>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** White surface with a hairline border. No header rule, no shadow. */
export function Card({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  padding = "md",
  headingLevel = 2,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** "none" for edge-to-edge tables/lists. */
  padding?: "none" | "sm" | "md";
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 3 ? "h3" : "h2";
  const pad = { none: "", sm: "p-4", md: "p-4 md:p-5" }[padding];
  const hasHead = !!(title || action);
  return (
    <div className={cn("pg-panel min-w-0", className)}>
      {hasHead && (
        <div className="pg-card-head flex items-start justify-between gap-3 px-4 pt-4 md:px-5">
          <div className="min-w-0">
            {title && <H className="pg-t-h3">{title}</H>}
            {description && <p className="pg-t-caption mt-0.5">{description}</p>}
          </div>
          {action && <div className="-my-1 flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      <div
        className={cn(
          pad,
          padding !== "none" && "pg-card-body",
          hasHead && padding !== "none" && "pt-3 md:pt-3",
          hasHead && padding === "none" && "pt-3",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Responsive grid helper for cards/sections. */
export function Grid({
  children,
  cols = 3,
  className,
}: {
  children: ReactNode;
  cols?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  const c = {
    1: "grid-cols-1",
    2: "grid-cols-1 lg:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
  }[cols];
  return <div className={cn("grid gap-4", c, className)}>{children}</div>;
}

/* ========================================================================== *
 * Numbers
 * ========================================================================== */

export type Delta = {
  /** Pre-formatted text, e.g. "+6.2 °C" or "−3 birds". */
  value: string;
  direction?: "up" | "down" | "flat";
  /** Is this change good, bad or neutral for the farmer? Drives colour. */
  sentiment?: "good" | "bad" | "neutral";
};

function DeltaText({ delta }: { delta: Delta }) {
  const Icon =
    delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  const cls =
    delta.sentiment === "good" ? "text-ok" : delta.sentiment === "bad" ? "text-crit" : "text-ink-3";
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-medium", cls)}>
      {delta.direction && <Icon className="size-3.5" aria-hidden />}
      {delta.value}
    </span>
  );
}

/**
 * A single KPI: quiet label, strong mono value, small unit, optional delta/sub.
 * `value` null/undefined renders "—" (never a fake 0).
 */
export function Metric({
  label,
  value,
  unit,
  sub,
  delta,
  status,
  loading,
  size = "md",
  className,
}: {
  label: ReactNode;
  value: ReactNode | null | undefined;
  unit?: string;
  sub?: ReactNode;
  delta?: Delta;
  /** Adds a status dot before the label (state, not metric type). */
  status?: Status;
  loading?: boolean;
  size?: "md" | "sm";
  className?: string;
}) {
  // "—" counts as empty too, so formatNumber(null) never renders "—W" in ink.
  const empty = value == null || value === "" || value === "—";
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5 text-[13px] leading-[18px] font-medium text-ink-3">
        {status && <span className={cn("pg-dot", statusText[status])} aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <Skeleton className={cn("mt-2", size === "md" ? "h-7 w-24" : "h-5 w-16")} />
      ) : (
        <div
          className={cn(
            size === "md" ? "pg-t-kpi mt-1.5" : "pg-t-kpi-sm mt-1",
            "whitespace-nowrap",
            empty && "text-ink-3",
          )}
        >
          {empty ? "—" : value}
          {!empty && unit && <span className="pg-unit">{unit}</span>}
        </div>
      )}
      {(delta || sub) && !loading && (
        <div className="pg-t-caption mt-1 flex flex-wrap items-center gap-x-2">
          {delta && <DeltaText delta={delta} />}
          {sub && <span className="min-w-0">{sub}</span>}
        </div>
      )}
    </div>
  );
}

/** A strip of Metrics in one panel with hairline dividers (not card soup). */
export function MetricGrid({
  children,
  cols = 4,
  className,
}: {
  children: ReactNode;
  cols?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  const c = {
    2: "grid-cols-2",
    3: "grid-cols-2 md:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-2 md:grid-cols-3 xl:grid-cols-5",
    6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
  }[cols];
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline",
        c,
        className,
      )}
    >
      {React.Children.toArray(children).map((child, i) => (
        <div key={i} className="pg-metric-cell min-w-0 bg-surface p-4 md:px-5">
          {child}
        </div>
      ))}
    </div>
  );
}

/** Legacy KPI tile (kept for compatibility). Icons are accepted but not drawn. */
export function StatCard({
  label,
  value,
  unit,
  hint,
  tone = "default",
  delta,
  loading,
  className,
}: {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
  icon?: LucideIcon;
  hint?: ReactNode;
  tone?: "default" | "success" | "warning" | "destructive";
  delta?: Delta;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("pg-panel p-4 md:p-5", className)}>
      <Metric
        label={label}
        value={value}
        unit={unit}
        sub={hint}
        delta={delta}
        loading={loading}
        status={tone === "default" ? undefined : toneToStatus[tone]}
      />
    </div>
  );
}

/** Labelled bar with a visible track. `value` is 0..1. */
export function Meter({
  value,
  status = "brand",
  label,
  valueLabel,
  className,
}: {
  value: number | null | undefined;
  status?: Status;
  label?: ReactNode;
  valueLabel?: ReactNode;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value ?? 0)) * 100;
  const fill = {
    ok: "bg-ok",
    warn: "bg-warn",
    crit: "bg-crit",
    info: "bg-info",
    offline: "bg-offline",
    neutral: "bg-ink-3",
    brand: "bg-brand",
  }[status];
  return (
    <div className={cn("min-w-0", className)}>
      {(label || valueLabel) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px] leading-[18px]">
          <span className="truncate text-ink-2">{label}</span>
          <span className="pg-num text-[12px] text-ink">
            {valueLabel ?? formatUnit(Math.round(pct), UNITS.pct, 0)}
          </span>
        </div>
      )}
      <div
        className="h-1.5 overflow-hidden rounded-full bg-sunken"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={typeof label === "string" ? label : undefined}
      >
        <div className={cn("h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Two-column label/value list. */
export function DescList({
  items,
  className,
  stackOnMobile = false,
}: {
  items: { label: ReactNode; value: ReactNode }[];
  className?: string;
  /** Phones: label above value, for values that are sentences rather than figures. */
  stackOnMobile?: boolean;
}) {
  return (
    <dl className={cn("divide-y divide-hairline text-[13px] leading-[18px]", className)}>
      {items.map((it, i) => (
        <div
          key={i}
          className={cn(
            "flex items-baseline justify-between gap-4 py-2",
            stackOnMobile && "max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-2.5",
          )}
        >
          <dt
            className={cn("shrink-0 text-ink-3", stackOnMobile && "max-sm:text-[12px] max-sm:leading-4")}
          >
            {it.label}
          </dt>
          <dd className={cn("pg-num min-w-0 text-right text-ink", stackOnMobile && "max-sm:text-left")}>
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ========================================================================== *
 * Status
 * ========================================================================== */

export function StatusDot({
  status,
  label,
  pulse,
  className,
}: {
  status: Status;
  /** Screen-reader text when the dot stands next to no word. */
  label?: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center", statusText[status], className)}>
      <span className={cn("pg-dot", pulse && "pg-dot--pulse")} aria-hidden />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Dot + word on a tint. The default way to show state. */
export function StatusPill({
  status,
  children,
  size = "md",
  pulse,
  className,
  title,
}: {
  status: Status;
  children: ReactNode;
  size?: "sm" | "md";
  pulse?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded font-medium whitespace-nowrap",
        size === "md" ? "h-6 px-2 text-[12px] leading-4" : "h-5 px-1.5 text-[11px] leading-4",
        statusClass[status],
        className,
      )}
    >
      <span
        className={cn("pg-dot", size === "sm" && "size-1.5", pulse && "pg-dot--pulse")}
        aria-hidden
      />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Small label. Sentence case text only ("Warning", not "warning"/"WARNING"). */
export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full items-center rounded px-1.5 text-[12px] leading-4 font-medium whitespace-nowrap",
        statusClass[toneToStatus[tone]],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ========================================================================== *
 * Loading / empty / error
 * ========================================================================== */

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <span aria-hidden className={cn("pg-skel h-4 w-full", className)} style={style} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: i === lines - 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}

/** Placeholder for a MetricGrid while data loads. */
export function SkeletonMetrics({
  count = 4,
  cols = 4,
}: {
  count?: number;
  cols?: 2 | 3 | 4 | 5 | 6;
}) {
  return (
    <div role="status" aria-label="Loading">
      <MetricGrid cols={cols}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} aria-hidden>
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="mt-3 h-7 w-24" />
          </div>
        ))}
      </MetricGrid>
    </div>
  );
}

/** Table/list placeholder with the same row height as DataTable. */
export function SkeletonRows({
  rows = 4,
  cols = 4,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-label="Loading" className={cn("pg-panel overflow-hidden", className)}>
      <div className="h-9 border-b border-hairline bg-sunken" />
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex h-11 items-center gap-6 border-b border-hairline px-4 last:border-0"
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton
              key={c}
              className="h-3.5"
              style={{ width: c === 0 ? "22%" : `${10 + ((r + c) % 3) * 4}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Left-aligned empty state: what will appear here + the next step.
 * - `action`: always <EmptyAction> (one CTA style: secondary button). Usually
 *   <EmptyAction to="/app/devices">Open devices</EmptyAction>.
 * - `note`: the role hint, e.g. "Ask a farm manager to add houses." (or <RoleNote>).
 * - `preview` (panel variant, md+): a ghost of what the page will show, in a right
 *   column. Use <GhostTable>, <GhostMetrics> or <GhostTile>. Hidden on phone, aria-hidden.
 * - `variant="inline"` drops the panel (use inside a Card).
 * - `icon` is accepted for compatibility but no longer drawn.
 */
export function EmptyState({
  title,
  description,
  action,
  secondary,
  note,
  preview,
  variant = "panel",
  className,
}: {
  /** @deprecated Not drawn. */
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  secondary?: ReactNode;
  note?: ReactNode;
  /** Ghost preview of the populated page (panel variant, md+ only). */
  preview?: ReactNode;
  variant?: "panel" | "inline";
  className?: string;
}) {
  const body = (
    <div className="max-w-[56ch] min-w-0">
      <h2 className="pg-t-h3">{title}</h2>
      {description && <p className="mt-1 text-[14px] leading-5 text-ink-2">{description}</p>}
      {(action || secondary) && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {action}
          {secondary}
        </div>
      )}
      {note && <div className="pg-t-caption mt-3">{note}</div>}
    </div>
  );
  if (variant === "inline") return <div className={cn("py-6", className)}>{body}</div>;
  return (
    <div
      className={cn(
        "pg-panel pg-empty px-5 py-8 md:px-8 md:py-10",
        preview && "md:grid md:grid-cols-[minmax(0,1fr)_320px] md:items-center md:gap-10",
        className,
      )}
    >
      {body}
      {preview && (
        <div aria-hidden className="pointer-events-none hidden min-w-0 select-none md:block">
          <div className="pg-t-caption mb-2">What you’ll see</div>
          <div className="opacity-60">{preview}</div>
        </div>
      )}
    </div>
  );
}

/**
 * The single empty-state CTA style (secondary, md). Pass `to` for a link or
 * `onClick` for an action. Default label "Open devices".
 */
export function EmptyAction({
  to,
  onClick,
  children = "Open devices",
}: {
  to?: React.ComponentProps<typeof Link>["to"];
  onClick?: () => void;
  children?: ReactNode;
}) {
  if (to)
    return (
      <Link to={to} className={buttonClass({ variant: "secondary" })}>
        {children}
      </Link>
    );
  return (
    <Button variant="secondary" onClick={onClick}>
      {children}
    </Button>
  );
}

/** Ghost of a table: real column names, skeleton bars. For EmptyState `preview`. */
export function GhostTable({ columns, rows = 3 }: { columns: string[]; rows?: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-hairline bg-surface">
      <div className="flex h-8 items-center gap-3 border-b border-hairline bg-sunken px-3">
        {columns.map((c) => (
          <span key={c} className="min-w-0 flex-1 truncate text-[11px] leading-4 text-ink-3">
            {c}
          </span>
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex h-9 items-center gap-3 border-b border-hairline px-3 last:border-0"
        >
          {columns.map((c, i) => (
            <span key={c} className="min-w-0 flex-1">
              <span
                className="block h-2 rounded-sm bg-sunken"
                style={{ width: `${i === 0 ? 80 : 40 + ((r + i) % 3) * 15}%` }}
              />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Ghost of a metric strip with real labels. For EmptyState `preview`. */
export function GhostMetrics({ labels }: { labels: string[] }) {
  return (
    <div
      className="grid gap-px overflow-hidden rounded-md border border-hairline bg-hairline"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, labels.length)}, minmax(0, 1fr))` }}
    >
      {labels.map((l) => (
        <div key={l} className="min-w-0 bg-surface px-3 py-2.5">
          <div className="truncate text-[11px] leading-4 text-ink-3">{l}</div>
          <span className="mt-2 block h-3 w-3/5 rounded-sm bg-sunken" />
        </div>
      ))}
    </div>
  );
}

/** Ghost of a media tile (camera, 16:9) with a caption. For EmptyState `preview`. */
export function GhostTile({ label, ratio = "16 / 9" }: { label: string; ratio?: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-hairline bg-surface">
      <div className="bg-sunken" style={{ aspectRatio: ratio }} />
      <div className="px-3 py-2 text-[12px] leading-4 text-ink-3">{label}</div>
    </div>
  );
}

/**
 * Role hint with a lock: "Managers can add houses." Put it in PageHeader
 * children (right side) or an EmptyState `note`. Pass the verb phrase only.
 */
export function RoleNote({ can, className }: { can: string; className?: string }) {
  return (
    <span className={cn("pg-t-caption inline-flex items-center gap-1.5", className)}>
      <Lock className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      Managers can {can}.
    </span>
  );
}

export function ErrorState({
  title = "Couldn’t load this data",
  description,
  error,
  onRetry,
  variant = "panel",
  className,
}: {
  title?: string;
  description?: ReactNode;
  error?: unknown;
  onRetry?: () => void;
  variant?: "panel" | "inline";
  className?: string;
}) {
  const msg = error instanceof Error ? error.message : undefined;
  return (
    <div
      role="alert"
      className={cn(variant === "panel" ? "pg-panel px-5 py-6 md:px-6" : "py-4", className)}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-crit" aria-hidden />
        <div className="min-w-0">
          <h2 className="pg-t-h3">{title}</h2>
          <p className="mt-1 text-[13px] leading-[18px] text-ink-2">
            {description ?? "Check the connection and try again."}
          </p>
          {msg && <p className="mt-1 text-[12px] leading-4 break-words text-ink-3">{msg}</p>}
          {onRetry && (
            <Button size="sm" className="mt-3" onClick={onRetry} icon={RotateCw}>
              Retry
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type QueryLike<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
};

/**
 * Renders loading / error / empty / data for a TanStack query.
 * <QueryState query={q} loading={<SkeletonRows/>} isEmpty={(d) => !d.length}
 *   empty={<EmptyState .../>}>{(rows) => <DataTable rows={rows} .../>}</QueryState>
 */
export function QueryState<T>({
  query,
  loading,
  empty,
  isEmpty,
  errorTitle,
  children,
}: {
  query: QueryLike<T>;
  loading: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  errorTitle?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{loading}</>;
  if (query.isError || query.data === undefined)
    return (
      <ErrorState title={errorTitle} error={query.error} onRetry={() => void query.refetch()} />
    );
  if (empty && isEmpty?.(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

/* ========================================================================== *
 * Buttons & controls
 * ========================================================================== */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function buttonClass({
  variant = "secondary",
  size = "md",
  iconOnly = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  iconOnly?: boolean;
  className?: string;
} = {}) {
  return cn(
    "pg-btn",
    `pg-btn--${variant}`,
    size === "sm" && "pg-btn--sm",
    iconOnly && "pg-btn--icon",
    className,
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  /** Shows a spinner, keeps the label, disables the button. */
  loading?: boolean;
  icon?: LucideIcon;
  /** Icon-only button: pass `aria-label`. */
  iconOnly?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading,
    icon: Icon,
    iconOnly,
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={buttonClass({ variant, size, iconOnly, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Loader2 className="pg-spin" aria-hidden />
      ) : (
        Icon && <Icon aria-hidden strokeWidth={1.75} />
      )}
      {children}
    </button>
  );
});

/** Row of filters/actions above a table or chart. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-3 flex flex-wrap items-center gap-2", className)}>{children}</div>;
}
export function ToolbarSpacer() {
  return <div className="flex-1" />;
}

/**
 * Single-choice segmented control (radiogroup with roving focus).
 *
 * activation:
 * - "auto" (default; ranges, filters, view tabs): arrow keys call onChange for
 *   the next option. Focus follows only once `value` actually changes, so a
 *   rejected/ignored change never leaves focus and aria-checked out of sync.
 * - "manual" (anything that commands hardware, e.g. fan mode): arrow keys
 *   (and Home/End) only move focus; Enter, Space or click commits. One
 *   onChange per deliberate choice, so no debouncing needed.
 * onChange is never called for the already-selected value.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  activation = "auto",
  disabled,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: ReactNode; disabled?: boolean }[];
  ariaLabel: string;
  activation?: "auto" | "manual";
  disabled?: boolean;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const groupRef = React.useRef<HTMLDivElement>(null);
  const checkedIdx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  // Roving tab stop. Manual mode lets it wander from the checked option.
  const [focusIdx, setFocusIdx] = React.useState(checkedIdx);
  const prevValue = React.useRef(value);

  React.useEffect(() => {
    if (prevValue.current === value) return;
    prevValue.current = value;
    setFocusIdx(checkedIdx);
    // Auto mode: focus follows the committed value if focus is in the group.
    if (groupRef.current?.contains(document.activeElement)) refs.current[checkedIdx]?.focus();
  }, [value, checkedIdx]);

  const commit = (i: number) => {
    const o = options[i];
    if (!o || o.disabled || disabled || o.value === value) return;
    onChange(o.value);
  };

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = options.length - 1;
    let n: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = i === last ? 0 : i + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = i === 0 ? last : i - 1;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = last;
    if (n == null) return;
    e.preventDefault();
    if (activation === "manual") {
      setFocusIdx(n);
      refs.current[n]?.focus();
    } else {
      commit(n);
    }
  };

  const stop = activation === "manual" ? focusIdx : checkedIdx;
  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn("pg-seg", className)}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === stop ? 0 : -1}
            disabled={disabled || o.disabled}
            onClick={() => commit(i)}
            onFocus={() => setFocusIdx(i)}
            onBlur={(e) => {
              // Leaving the group resets the tab stop to the checked option.
              if (!groupRef.current?.contains(e.relatedTarget as Node | null))
                setFocusIdx(checkedIdx);
            }}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Accessible switch. `pending` = waiting for the device to acknowledge. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  pending,
  disabled,
  id,
  className,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  /** Accessible name if no visible <label htmlFor> exists. */
  label?: string;
  pending?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn("pg-switch", className)}
    />
  );
}

/* ========================================================================== *
 * Forms
 * ========================================================================== */

/**
 * Label above control, hint below, error replaces hint. Wires id,
 * aria-describedby and aria-invalid into its single child automatically.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  id: idProp,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: React.ReactElement<Record<string, unknown>>;
  className?: string;
  id?: string;
}) {
  const auto = React.useId();
  const childId = (children.props.id as string | undefined) ?? idProp ?? `f${auto}`;
  const descId = `${childId}-desc`;
  const control = React.cloneElement(children, {
    id: childId,
    "aria-describedby": hint || error ? descId : undefined,
    "aria-invalid": error ? true : undefined,
    required: (children.props.required as boolean | undefined) ?? required,
  });
  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={childId}
        className="mb-1.5 block text-[13px] leading-[18px] font-medium text-ink"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-ink-3" aria-hidden>
            *
          </span>
        )}
      </label>
      {control}
      {(error || hint) && (
        <p
          id={descId}
          className={cn("mt-1.5 text-[12px] leading-4", error ? "text-crit" : "text-ink-3")}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn("pg-input", className)} {...p} />;
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={cn("pg-input", className)} {...p} />;
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn("pg-input", className)} {...p} />;
});

/* ========================================================================== *
 * Modal (Radix: focus trap, Esc, aria-modal, focus return). Sheet on phone.
 * ========================================================================== */

/**
 * Focus: on open, the first enabled input/select/textarea in the body gets focus
 * (else Radix's default). On close, focus returns to whatever had focus when it
 * opened (the button that opened it), even with a controlled `open` and no
 * Dialog.Trigger. Pass `returnFocusRef` to send focus somewhere else.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Buttons. Put the primary action last. */
  footer?: ReactNode;
  className?: string;
  /** Element to focus on close (default: the element focused before opening). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const opener = React.useRef<HTMLElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="pg-console pg-modal-overlay" />
        <DialogPrimitive.Content
          className={cn("pg-console pg-modal", className)}
          onOpenAutoFocus={(e) => {
            // Radix fires this before moving focus, so activeElement is still the opener.
            const a = document.activeElement;
            opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
            const field = bodyRef.current?.querySelector<HTMLElement>(
              "input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)",
            );
            if (field) {
              e.preventDefault();
              field.focus();
            }
          }}
          onCloseAutoFocus={(e) => {
            const target = returnFocusRef?.current ?? opener.current;
            if (target?.isConnected) {
              e.preventDefault();
              target.focus();
            }
            opener.current = null;
          }}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="pg-t-h2">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-[13px] leading-[18px] text-ink-3">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">
                  {title}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="pg-iconbtn -mt-1 -mr-2" aria-label="Close">
              <X aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div ref={bodyRef} className="px-5 pt-4 pb-5">
            {children}
          </div>
          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-hairline px-5 py-4 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ========================================================================== *
 * DataTable — table on md+, stacked two-line rows on phone
 * ========================================================================== */

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** e.g. "w-40" or "w-[1%]" */
  className?: string;
  /**
   * Phone layout: "title" = line 1 left (one column), "status" = line 1 right,
   * "meta" (default) = a label-over-value cell in a 2-column grid below,
   * "wide" = a meta cell across both columns (controls), "hide" = not shown.
   */
  mobile?: "title" | "status" | "meta" | "wide" | "hide";
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  caption,
  loading,
  loadingRows = 4,
  empty,
  bare,
  className,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Screen-reader caption. */
  caption?: string;
  loading?: boolean;
  loadingRows?: number;
  /** Shown when rows is empty (EmptyState variant="inline" works well). */
  empty?: ReactNode;
  /** Drop the outer panel border (when already inside a Card padding="none"). */
  bare?: boolean;
  className?: string;
}) {
  if (loading || !rows) {
    return (
      <SkeletonRows
        rows={loadingRows}
        cols={Math.min(columns.length, 5)}
        className={cn(bare && "rounded-none border-0", className)}
      />
    );
  }
  if (rows.length === 0 && empty) return <>{empty}</>;

  const mobileRole = (c: Column<T>, i: number) => c.mobile ?? (i === 0 ? "title" : "meta");
  const titleCol = columns.find((c, i) => mobileRole(c, i) === "title");
  const statusCol = columns.find((c, i) => mobileRole(c, i) === "status");
  const metaCols = columns.filter((c, i) => ["meta", "wide"].includes(mobileRole(c, i)));
  const click = (row: T) =>
    onRowClick
      ? (e: React.MouseEvent) => {
          // Clicks on nested controls/links belong to them, not the row.
          const host = (e.target as HTMLElement).closest(
            "button, a, input, select, textarea, label",
          );
          if (host && host !== e.currentTarget && e.currentTarget.contains(host)) return;
          onRowClick(row);
        }
      : undefined;
  const keyNav = (row: T) =>
    onRowClick
      ? (e: React.KeyboardEvent) => {
          // Only the row itself: never hijack Enter/Space on a nested button or input.
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onRowClick(row);
          }
        }
      : undefined;

  return (
    <div className={cn(!bare && "pg-panel", "min-w-0", className)}>
      {/* md+ table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="pg-table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(c.align === "right" && "pg-right", c.className)}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                data-clickable={onRowClick ? "true" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={click(row)}
                onKeyDown={keyNav(row)}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(c.align === "right" && "pg-right pg-num", c.className)}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* phone list */}
      <ul className="md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className="pg-list-row"
            data-clickable={onRowClick ? "true" : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onClick={click(row)}
            onKeyDown={keyNav(row)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-[14px] leading-5 font-medium text-ink">
                {titleCol?.cell(row)}
              </div>
              {statusCol && <div className="shrink-0">{statusCol.cell(row)}</div>}
            </div>
            {metaCols.length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[14px] leading-5">
                {metaCols.map((c) => (
                  <div
                    key={c.key}
                    className={cn("flex min-w-0 flex-col gap-1", c.mobile === "wide" && "col-span-2")}
                  >
                    <dt className="text-[12px] leading-4 text-ink-3">{c.header}</dt>
                    <dd className="pg-num m-0 min-w-0 text-ink">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ========================================================================== *
 * Charts (Recharts helpers)
 * ========================================================================== */

/**
 * Theme-following colours as CSS variables (valid in SVG fill/stroke and in
 * inline styles), so charts switch with the console theme without a re-render.
 * Series order in Field: green, ochre, slate, clay. Don't string-concatenate
 * alpha onto these; use fillOpacity/strokeOpacity or color-mix() instead.
 */
export const chartColors = {
  series: [
    "var(--pg-chart-1)",
    "var(--pg-chart-2)",
    "var(--pg-chart-3)",
    "var(--pg-chart-4)",
  ] as const,
  grid: "var(--pg-chart-grid)",
  axis: "var(--pg-ink-3)",
  axisLine: "var(--pg-hairline)",
  cursor: "var(--pg-line-strong)",
  target: "var(--pg-chart-target)",
  ok: "var(--pg-ok)",
  warn: "var(--pg-warn)",
  crit: "var(--pg-crit)",
  info: "var(--pg-info)",
  offline: "var(--pg-ink-disabled)",
} as const;

// Plex Sans with tabular figures (mono is reserved for IDs and KPI values).
const tick = {
  fill: chartColors.axis,
  fontSize: 11,
  fontFamily: "var(--pg-font-sans)",
  style: { fontVariantNumeric: "tabular-nums" },
};

/** Spread onto <XAxis {...xAxisProps} dataKey="t" tickFormatter={timeTick} />. */
export const xAxisProps = {
  tick,
  tickLine: false,
  axisLine: { stroke: chartColors.axisLine },
  tickMargin: 8,
  minTickGap: 32,
} as const;

/** Spread onto <YAxis {...yAxisProps} domain={fitDomain(1)} />. */
export const yAxisProps = {
  tick,
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  width: 40,
} as const;

/** <CartesianGrid {...gridProps} /> — horizontal hairlines only. */
export const gridProps = { vertical: false, stroke: chartColors.grid } as const;

/** <Line {...lineProps} dataKey="temp" stroke={chartColors.series[0]} />. No gradients/areas. */
export const lineProps = {
  type: "monotone",
  strokeWidth: 2,
  dot: false,
  activeDot: { r: 3.5, strokeWidth: 0 },
  isAnimationActive: false,
  connectNulls: false,
} as const;

/**
 * <ReferenceArea {...targetBandProps} y1={20} y2={24} /> for age-based targets.
 * Include the band in niceScale(values, { include: [20, 24] }) so ticks stay even.
 */
export const targetBandProps = {
  fill: chartColors.target,
  fillOpacity: 0.12,
  stroke: chartColors.target,
  strokeOpacity: 0.25,
  strokeDasharray: "3 3",
  ifOverflow: "extendDomain",
} as const;

/** <Tooltip content={<ChartTooltip unit="°C" />} cursor={tooltipCursor} /> */
export const tooltipCursor = { stroke: chartColors.cursor, strokeWidth: 1 } as const;

/** A "nice" tick step (1, 2 or 5 × 10^n) for a span split into ~`count` gaps. */
export function niceStep(span: number, count = 4) {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const f = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return f * mag;
}

export interface NiceScale {
  domain: [number, number];
  ticks: number[];
  step: number;
}

/**
 * Even Y ticks for a set of values, optionally forced to include a target band.
 *   const y = niceScale(points.map(p => p.temperature), { include: [20, 24], pad: 0.5 });
 *   <YAxis {...yAxisProps} {...yScaleProps(y)} />
 * - `count`: about how many gaps (default 5 -> 4–7 ticks).
 * - `pad`: added below/above the data before rounding (default 0).
 * - `step`: force a step, e.g. 2 for °C or 10 for % RH.
 * - `min`/`max`: hard clamps (e.g. { min: 0, max: 100 } for % values).
 * No finite values -> null (render the chart's empty state instead).
 */
export function niceScale(
  values: readonly (number | null | undefined)[],
  opts: {
    include?: readonly (number | null | undefined)[];
    count?: number;
    pad?: number;
    step?: number;
    min?: number;
    max?: number;
  } = {},
): NiceScale | null {
  const all = [...values, ...(opts.include ?? [])].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (!all.length) return null;
  const pad = opts.pad ?? 0;
  let lo = Math.min(...all) - pad;
  let hi = Math.max(...all) + pad;
  if (opts.min != null) lo = Math.max(lo, opts.min);
  if (opts.max != null) hi = Math.min(hi, opts.max);
  if (hi - lo < 1e-9) {
    // Flat data: give it some air around the single value.
    const air = Math.abs(lo) * 0.05 || 1;
    lo -= air;
    hi += air;
  }
  const step = +(opts.step ?? niceStep(hi - lo, opts.count ?? 5)).toPrecision(10);
  let a = Math.floor(lo / step) * step;
  let b = Math.ceil(hi / step) * step;
  if (opts.min != null) a = Math.max(a, opts.min);
  if (opts.max != null) b = Math.min(b, opts.max);
  const decimals = (String(step).split(".")[1] ?? "").length;
  const round = (v: number) => +v.toFixed(Math.min(6, decimals));
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 1e6; v += step) ticks.push(round(v));
  return { domain: [round(a), round(b)], ticks, step };
}

/** Spread onto <YAxis>: explicit domain + ticks from niceScale (empty object when null). */
export function yScaleProps(s: NiceScale | null) {
  if (!s) return {};
  return {
    domain: s.domain,
    ticks: s.ticks,
    interval: 0 as const,
    allowDecimals: s.step % 1 !== 0,
  };
}

/**
 * Legacy domain function (Recharts calls each side separately). Prefer
 * niceScale + yScaleProps, which also fixes the ticks. `step` rounds each end
 * to a multiple of it (default 1).
 */
export function fitDomain(pad = 1, step = 1): [(min: number) => number, (max: number) => number] {
  return [
    (min) => Math.floor((min - pad) / step) * step,
    (max) => Math.ceil((max + pad) / step) * step,
  ];
}

/** Axis label for ISO/epoch: "14:20" within a day, else "3 Oct". */
export function timeTick(v: string | number) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return Date.now() - d.getTime() < 86_400_000
    ? formatTime(d)
    : d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
}

/** Axis label with day and time, "3 Oct 23:20": for sparse series where timeTick repeats. */
export function dateTimeTick(v: string | number) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" })} ${formatTime(d)}`;
}

type TipItem = {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  dataKey?: string | number;
  unit?: string | number;
};

/** Surface tooltip with mono values + units. Pass as `content={<ChartTooltip unit="°C" />}`. */
export function ChartTooltip({
  active,
  payload,
  label,
  unit,
  units,
  labelFormatter = (l) => (l == null ? "" : timeTick(l as string)),
  valueFormatter = (v) => formatNumber(v),
}: {
  active?: boolean;
  payload?: TipItem[];
  label?: string | number;
  unit?: string;
  /** Per-dataKey units, e.g. { temp: "°C", rh: "%" }. */
  units?: Record<string, string>;
  labelFormatter?: (l: string | number | undefined) => ReactNode;
  valueFormatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="pg-chart-tip">
      <div className="mb-1 text-ink-3">{labelFormatter(label)}</div>
      {payload.map((p, i) => {
        const u =
          (p.dataKey != null && units?.[String(p.dataKey)]) || unit || (p.unit as string) || "";
        const v = typeof p.value === "number" ? valueFormatter(p.value) : String(p.value ?? "—");
        return (
          <div key={i} className="flex items-center justify-between gap-4 leading-5">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span
                className="inline-block h-0.5 w-2.5 rounded"
                style={{ background: p.color }}
                aria-hidden
              />
              {p.name}
            </span>
            <span className="pg-num font-medium text-ink">
              {v}
              {u && <span className="font-normal text-ink-3">{NBSP + u}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ChartLegend({
  items,
  className,
}: {
  items: { label: ReactNode; color: string; kind?: "line" | "band" | "dot" }[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] leading-4 text-ink-2",
        className,
      )}
    >
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "inline-block",
              it.kind === "band"
                ? "h-2.5 w-3 rounded-sm"
                : it.kind === "dot"
                  ? "size-2 rounded-full"
                  : "h-0.5 w-3 rounded",
            )}
            style={{ background: it.color, opacity: it.kind === "band" ? 0.25 : 1 }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Fixed-height chart container with designed loading + empty states.
 * Put a recharts <ResponsiveContainer> inside as children.
 */
export function ChartFrame({
  height = 240,
  loading,
  empty,
  emptyTitle = "No readings yet",
  emptyHint,
  legend,
  pointCount,
  children,
  className,
}: {
  height?: number;
  loading?: boolean;
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: ReactNode;
  legend?: ReactNode;
  /**
   * Number of plotted points. Under 6, the plot shrinks to 140px and a caption
   * says "Only N readings. The trend fills in as the Pi reports."
   */
  pointCount?: number;
  children: ReactNode;
  className?: string;
}) {
  const sparse = !loading && !empty && pointCount != null && pointCount > 0 && pointCount < 6;
  const h = sparse ? Math.min(height, 140) : height;
  return (
    <div className={cn("min-w-0", className)}>
      {legend && <div className="mb-3">{legend}</div>}
      <div className="relative" style={{ height: h }}>
        {loading ? (
          <Skeleton className="h-full w-full rounded-md" />
        ) : empty ? (
          <div className="flex h-full flex-col justify-center rounded-md border border-dashed border-line-strong px-5">
            <p className="pg-t-h3">{emptyTitle}</p>
            {emptyHint && (
              <p className="mt-1 max-w-[52ch] text-[13px] leading-[18px] text-ink-3">{emptyHint}</p>
            )}
          </div>
        ) : (
          children
        )}
      </div>
      {sparse && (
        <p className="pg-t-caption mt-2">
          Only {pointCount} {pointCount === 1 ? "reading" : "readings"}. The trend fills in as the
          Pi reports.
        </p>
      )}
    </div>
  );
}
