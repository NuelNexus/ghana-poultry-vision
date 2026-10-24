// Instrument-style pieces for the Pi's readings: the temperature comfort
// scale, small gauges for humidity / gas / light, the fan relay switch and
// the severity marks used by alert rows. They all draw from the console
// tokens (styles.css) so every theme and dark mode works.

import type { ReactNode } from "react";
import type { AiStatus, SensorHealth, SensorState } from "@/lib/api/types";
import {
  formatFan,
  formatLight,
  formatNumber,
  formatTemp,
  formatTempDelta,
  toTemp,
} from "@/components/ui-kit";
import { cn } from "@/lib/utils";

/** Gas index lines, same as edge/poultrygrid/features.py label_state. */
export const GAS_WARN = 14;
export const GAS_CRIT = 22;
/** Broiler house relative-humidity comfort range. */
export const RH_BAND: [number, number] = [50, 70];

/**
 * Comfortable house temperature range for the flock's age, mirroring
 * comfort_band() on the Pi: chicks get a tight band, older birds in open-sided
 * Ghanaian houses are fine up to about 26 °C.
 */
export function comfortBand(target: number, ageDays: number | null | undefined): [number, number] {
  const high = ageDays != null && ageDays < 14 ? target + 1.5 : Math.max(target + 1.5, 26);
  return [target - 1.5, high];
}

type Tone = "ok" | "warn" | "crit" | "off";

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  off: "text-ink-3",
};
const TONE_BG: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  off: "bg-ink-3",
};
const TONE_TINT: Record<Tone, string> = {
  ok: "bg-ok-tint",
  warn: "bg-warn-tint",
  crit: "bg-crit-tint",
  off: "bg-offline-tint",
};

export function statusTone(s: AiStatus | null | undefined, stale = false): Tone {
  if (stale || !s) return "off";
  return s === "critical" ? "crit" : s === "warning" ? "warn" : "ok";
}

/**
 * Severity mark: a shape, not just a colour, so it reads in greyscale too.
 * ok = circle, warn = triangle, crit = diamond, off = hollow circle.
 */
export function SeverityMark({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      className={cn("size-3 shrink-0", TONE_TEXT[tone], className)}
    >
      {tone === "ok" && <circle cx="6" cy="6" r="4.5" fill="currentColor" />}
      {tone === "warn" && <path d="M6 1.2 11 10.5H1Z" fill="currentColor" />}
      {tone === "crit" && <path d="M6 .8 11.2 6 6 11.2.8 6Z" fill="currentColor" />}
      {tone === "off" && (
        <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}

/** Square status tile that leads a readout: tinted block with the severity mark. */
export function VerdictTile({ tone, size = "md" }: { tone: Tone; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-[var(--pg-r-ctl)]",
        TONE_TINT[tone],
        tone === "off" && "pg-hatch",
        size === "md" ? "size-11" : "size-8",
      )}
    >
      <SeverityMark tone={tone} className={size === "md" ? "size-4" : "size-3"} />
    </span>
  );
}

/** "Offline since …" strip with a hatched background: the values below are old. */
export function StaleStrip({ children }: { children: ReactNode }) {
  return (
    <div className="pg-hatch border-b border-hairline px-4 py-2 text-[12px] leading-4 text-ink-2 md:px-5">
      {children}
    </div>
  );
}

const pct = (v: number, lo: number, hi: number) =>
  Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));

/**
 * Temperature on a scale with the age-based comfort band drawn on it, so
 * "28.2 °C" reads as "a few degrees too warm for 4-week birds" at a glance.
 */
export function ComfortScale({
  temperature,
  target,
  ageDays,
  stale,
}: {
  temperature: number | null;
  target: number | null;
  ageDays: number | null;
  stale?: boolean;
}) {
  if (temperature == null || target == null) return null;
  const [low, high] = comfortBand(target, ageDays);
  const lo = Math.floor(Math.min(low - 4, temperature - 2) / 2) * 2;
  const hi = Math.ceil(Math.max(high + 6, temperature + 2) / 2) * 2;
  const step = hi - lo > 24 ? 4 : 2;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += step) ticks.push(t);
  const over = temperature - high;
  const under = low - temperature;
  const tone: Tone = stale
    ? "off"
    : over > 4 || under > 3
      ? "crit"
      : over > 1.5 || under > 1
        ? "warn"
        : "ok";
  const at = pct(temperature, lo, hi);
  const fmt = (c: number) => formatNumber(toTemp(c)!, { maximumFractionDigits: 0 });

  return (
    <figure className="m-0 flex flex-col-reverse">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-1 pb-2">
        <span className="text-[12px] leading-4 text-ink-2">
          {over > 0.5 ? (
            <>
              <span className="pg-mono">{formatTempDelta(over).slice(1)}</span> above comfortable
            </>
          ) : under > 0.5 ? (
            <>
              <span className="pg-mono">{formatTempDelta(under).slice(1)}</span> below comfortable
            </>
          ) : (
            "Within the comfortable range"
          )}
        </span>
        <span className="text-[12px] leading-4 text-ink-3">
          Comfortable for flock age{" "}
          <span className="pg-mono text-ink-2">
            {fmt(low)}–{formatTemp(high, 0)}
          </span>
        </span>
      </figcaption>
      <div
        className="relative mt-7 h-8"
        role="img"
        aria-label={`${formatTemp(temperature)}, comfortable range ${formatTemp(low)} to ${formatTemp(high)}`}
      >
        {/* track */}
        <div className="absolute inset-x-0 top-2 h-2 rounded-full bg-sunken" />
        {/* comfort band */}
        <div
          className="absolute top-1 h-4 rounded-[3px] border border-ok/50 bg-ok-tint"
          style={{
            left: `${pct(low, lo, hi)}%`,
            width: `${pct(high, lo, hi) - pct(low, lo, hi)}%`,
          }}
        />
        {/* ticks */}
        {ticks.map((t, i) => (
          <span
            key={t}
            className={cn(
              "pg-mono absolute top-5 -translate-x-1/2 text-[10px] leading-3 text-ink-3",
              // Phones: every other number, so they don't run into each other.
              i % 2 === 1 && "max-sm:hidden",
            )}
            style={{ left: `${pct(t, lo, hi)}%` }}
          >
            {fmt(t)}
          </span>
        ))}
        {/* reading */}
        <div className="absolute -top-6 bottom-3 -translate-x-1/2" style={{ left: `${at}%` }}>
          <span
            className={cn(
              "pg-mono absolute bottom-full left-1/2 -translate-x-1/2 text-[13px] leading-4 font-semibold whitespace-nowrap",
              tone === "off" ? "text-ink-2" : "text-ink",
            )}
          >
            {formatTemp(temperature)}
          </span>
          <span className={cn("mx-auto block h-full w-[3px] rounded-full", TONE_BG[tone])} />
        </div>
      </div>
    </figure>
  );
}

/** A thin horizontal meter with optional shaded zones and a marker. */
function Meter({
  value,
  min,
  max,
  zones = [],
  tone,
}: {
  value: number;
  min: number;
  max: number;
  zones?: { from: number; to: number; className: string }[];
  tone: Tone;
}) {
  return (
    <div className="relative mt-2 h-1.5 rounded-full bg-sunken" aria-hidden>
      {zones.map((z) => (
        <span
          key={z.from}
          className={cn("absolute inset-y-0", z.className)}
          style={{
            left: `${pct(z.from, min, max)}%`,
            width: `${pct(z.to, min, max) - pct(z.from, min, max)}%`,
          }}
        />
      ))}
      <span
        className={cn("absolute -top-1 h-3.5 w-[3px] -translate-x-1/2 rounded-full", TONE_BG[tone])}
        style={{ left: `${pct(value, min, max)}%` }}
      />
    </div>
  );
}

function Gauge({
  label,
  source,
  children,
  value,
  unit,
  note,
  stale,
}: {
  label: string;
  source: string;
  children?: ReactNode;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  stale?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3.5 md:px-5">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-[12px] leading-4 text-ink-2">{label}</dt>
        <span className="pg-mono text-[10px] leading-3 text-ink-3 max-sm:hidden">{source}</span>
      </div>
      <dd className="m-0">
        <span
          className={cn(
            "pg-mono mt-1.5 block text-[22px] leading-7 font-medium tracking-tight",
            stale ? "text-ink-2" : "text-ink",
          )}
        >
          {value}
          {unit && (
            <span className="ml-1 font-sans text-[12px] font-normal text-ink-3">{unit}</span>
          )}
        </span>
        {children}
        {note && <span className="mt-1.5 block text-[12px] leading-4 text-ink-3">{note}</span>}
      </dd>
    </div>
  );
}

/** What a faulty sensor's gauge says instead of its usual note. */
const FAULT_NOTE: Record<Exclude<SensorState, "ok">, string> = {
  missing: "Not responding, check wiring",
  implausible: "Bad readings, check wiring",
  stuck: "Frozen, check the sensor",
  not_wired: "Not connected",
};

const SENSOR_PART: Record<keyof SensorHealth, string> = {
  temperature: "DHT22",
  humidity: "DHT22",
  gas_index: "MQ-135",
  light: "LDR",
};

/**
 * Faulty sensors from the Pi's health check, grouped by part:
 * [{ part: "DHT22", state: "missing" }]. Not-wired sensors aren't faults.
 */
export function sensorFaults(health: SensorHealth | null | undefined) {
  const out = new Map<string, Exclude<SensorState, "ok" | "not_wired">>();
  for (const [k, v] of Object.entries(health ?? {}) as [keyof SensorHealth, SensorState][]) {
    if (v && v !== "ok" && v !== "not_wired" && !out.has(SENSOR_PART[k]))
      out.set(SENSOR_PART[k], v);
  }
  return [...out].map(([part, state]) => ({ part, state }));
}

/** Humidity, gas, light and the fan relay as a strip of gauges. */
export function SensorGauges({
  humidity,
  gas,
  light,
  fanOn,
  stale,
  health,
  className,
}: {
  humidity: number | null;
  gas: number | null;
  light: number | null;
  fanOn: boolean | null;
  stale?: boolean;
  health?: SensorHealth | null;
  className?: string;
}) {
  const fault = (k: keyof SensorHealth) => {
    const s = health?.[k];
    return s && s !== "ok" ? FAULT_NOTE[s] : null;
  };
  const rhTone: Tone =
    humidity == null || stale
      ? "off"
      : humidity > 85 || humidity < 30
        ? "crit"
        : humidity > RH_BAND[1] + 5 || humidity < RH_BAND[0] - 10
          ? "warn"
          : "ok";
  const gasTone: Tone =
    gas == null || stale ? "off" : gas >= GAS_CRIT ? "crit" : gas >= GAS_WARN ? "warn" : "ok";
  const dash = <span className="text-ink-3">—</span>;

  return (
    <dl
      className={cn(
        "m-0 grid grid-cols-2 divide-hairline md:grid-cols-4 [&>*]:border-hairline",
        "[&>*:nth-child(2n)]:border-l md:[&>*:nth-child(n+2)]:border-l max-md:[&>*:nth-child(n+3)]:border-t",
        className,
      )}
    >
      <Gauge
        label="Humidity"
        source="DHT22"
        stale={stale}
        value={humidity != null ? formatNumber(humidity, { maximumFractionDigits: 0 }) : dash}
        unit={humidity != null ? "% RH" : undefined}
        note={fault("humidity") ?? `Aim ${RH_BAND[0]}–${RH_BAND[1]} %`}
      >
        {humidity != null && (
          <Meter
            value={humidity}
            min={0}
            max={100}
            tone={rhTone}
            zones={[{ from: RH_BAND[0], to: RH_BAND[1], className: "bg-ok-tint" }]}
          />
        )}
      </Gauge>
      <Gauge
        label="Gas index"
        source="MQ-135"
        stale={stale}
        value={gas != null ? formatNumber(gas) : dash}
        note={
          fault("gas_index") ??
          (gas == null
            ? "No reading"
            : gas >= GAS_CRIT
              ? "High, ventilate"
              : gas >= GAS_WARN
                ? "Rising"
                : "Clean air")
        }
      >
        {gas != null && (
          <Meter
            value={Math.min(gas, 40)}
            min={0}
            max={40}
            tone={gasTone}
            zones={[
              { from: GAS_WARN, to: GAS_CRIT, className: "bg-warn-tint" },
              { from: GAS_CRIT, to: 40, className: "bg-crit-tint" },
            ]}
          />
        )}
      </Gauge>
      <Gauge
        label="Light"
        source="LDR"
        stale={stale}
        value={light != null ? formatLight(light) : dash}
        note={fault("light") ?? (light != null ? "Relative, not lux" : "No reading")}
      >
        {light != null && <LightSteps level={light} stale={stale} />}
      </Gauge>
      <Gauge
        label="Fan"
        source="Relay"
        stale={stale}
        value={formatFan(fanOn)}
        note={fanOn == null ? "No reading" : fanOn ? "Relay closed" : "Relay open"}
      >
        {fanOn != null && <RelaySwitch on={fanOn} stale={stale} className="mt-2" />}
      </Gauge>
    </dl>
  );
}

function LightSteps({ level, stale }: { level: number; stale?: boolean }) {
  const lit = level < 8 ? 1 : level < 20 ? 2 : 3;
  return (
    <span className="mt-2 flex items-end gap-1" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "w-3 rounded-[2px]",
            i <= lit ? (stale ? "bg-ink-3" : "bg-ochre") : "bg-sunken",
          )}
          style={{ height: 4 + i * 3 }}
        />
      ))}
    </span>
  );
}

/** On/off indicator drawn like a rocker switch: there is no speed, only a relay. */
export function RelaySwitch({
  on,
  stale,
  className,
}: {
  on: boolean;
  stale?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-3.5 w-7 items-center rounded-full border transition-colors",
        on
          ? stale
            ? "border-ink-3 bg-ink-3"
            : "border-brand bg-brand"
          : "border-line-strong bg-sunken",
        className,
      )}
    >
      <span
        className={cn(
          "absolute size-2.5 rounded-full bg-surface shadow-[0_0_0_1px_var(--pg-line-strong)] transition-[left]",
          on ? "left-[15px]" : "left-[1px]",
        )}
      />
    </span>
  );
}
