import type { ReactNode } from "react";
import { Cpu, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { FRESHNESS_MS, type AiSnapshot, type AiStatus, type Reading } from "@/lib/api/types";
import {
  StatusPill,
  formatDateTime,
  formatRelative,
  formatTime,
  freshness,
  lastKnown,
  useDisplayPrefs,
  useNow,
  type Status,
} from "@/components/ui-kit";
import {
  ComfortScale,
  SensorGauges,
  SeverityMark,
  StaleStrip,
  VerdictTile,
  sensorFaults,
  statusTone,
} from "@/components/coop-readout";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<
  AiStatus,
  {
    label: string;
    tone: "success" | "warning" | "destructive";
    /** ui-kit Status for StatusPill/StatusDot. */
    status: Status;
    icon: typeof ShieldCheck;
    /** Hex (SVG-safe) for charts. */
    color: string;
  }
> = {
  healthy: {
    label: "Healthy",
    tone: "success",
    status: "ok",
    icon: ShieldCheck,
    color: "var(--pg-ok)",
  },
  warning: {
    label: "Warning",
    tone: "warning",
    status: "warn",
    icon: ShieldAlert,
    color: "var(--pg-warn)",
  },
  critical: {
    label: "Critical",
    tone: "destructive",
    status: "crit",
    icon: ShieldX,
    color: "var(--pg-crit)",
  },
};

export const PHASE_LABEL: Record<string, string> = {
  brooding: "Brooding (week 1)",
  starter: "Starter (wk 2–3)",
  grower: "Grower (wk 4–5)",
  finisher: "Finisher (wk 6+)",
};

/** Older than `ms` (default FRESHNESS_MS.delayed, 5 min) = stale, same as freshness(). */
export function isStale(
  r: { created_at: string } | null | undefined,
  ms: number = FRESHNESS_MS.delayed,
) {
  return !r || Date.now() - new Date(r.created_at).getTime() > ms;
}

/**
 * State pill for an AI reading. Pass `at` (reading time) so stale readings
 * render as grey "Warning · last known" instead of a live-looking status.
 */
export function AiStatusBadge({
  status,
  at,
  size = "sm",
}: {
  status: AiStatus | null | undefined;
  at?: string | null;
  size?: "sm" | "md";
}) {
  useDisplayPrefs();
  if (!status)
    return (
      <StatusPill status="offline" size={size}>
        No AI data
      </StatusPill>
    );
  const meta = STATUS_META[status];
  if (at && isStale({ created_at: at }))
    return (
      <StatusPill
        status="offline"
        size={size}
        title={`${freshness(at).caption} · ${formatDateTime(at)}`}
      >
        {lastKnown(meta.label)}
      </StatusPill>
    );
  return (
    <StatusPill status={meta.status} size={size}>
      {meta.label}
    </StatusPill>
  );
}

/**
 * Readout for one device's latest edge-AI reading: verdict and advice, the
 * temperature on its comfort band, then gauges for every sensor on the Pi.
 * `headline` replaces the default title (the top cause, or "Conditions look
 * good"); `children` render under the gauges (the overview's device table).
 */
export function AiStatusPanel({
  r,
  headline,
  showModel = true,
  children,
}: {
  r: AiSnapshot | Reading;
  headline?: ReactNode;
  showModel?: boolean;
  children?: ReactNode;
}) {
  const now = useNow(15_000);
  useDisplayPrefs();
  const status = r.ai_status ?? "healthy";
  const meta = STATUS_META[status];
  const fresh = freshness(r.created_at, now);
  const stale = fresh.state === "stale" || fresh.state === "none";
  const tone = statusTone(r.ai_status, stale);
  const where = "house_name" in r ? (r.house_name ?? r.device_code) : null;
  const conf = r.ai_confidence != null ? Math.round(r.ai_confidence * 100) : null;
  const causes = status !== "healthy" && r.ai_causes ? r.ai_causes : [];
  const [top, ...others] = causes;
  const phase = r.growth_phase ? (PHASE_LABEL[r.growth_phase] ?? r.growth_phase) : null;
  const health = r.payload?.sensors;
  const faults = sensorFaults(health);
  const title =
    headline ?? (top ? top.label : status === "healthy" ? "Conditions look good" : meta.label);

  return (
    <section
      className="pg-panel overflow-hidden"
      aria-label={`${where ? where + " " : ""}coop condition`}
    >
      {stale && (
        <StaleStrip>
          <span className="font-medium text-ink">No live data.</span> The Pi
          {where ? ` in ${where}` : ""} last reported {formatRelative(r.created_at, now)} (
          {formatDateTime(r.created_at)}). These are its last known values. Check its power and
          network.
        </StaleStrip>
      )}

      {faults.length > 0 && !stale && (
        <div className="border-b border-hairline bg-warn-tint px-4 py-2 text-[12px] leading-4 text-ink md:px-5">
          <span className="font-semibold text-warn">Sensor problem:</span>{" "}
          {faults
            .map(
              (f) =>
                `${f.part} ${f.state === "missing" ? "not responding" : f.state === "stuck" ? "frozen" : "sending bad readings"}`,
            )
            .join(", ")}
          . The AI works around it using the other sensors. Check the wiring.
        </div>
      )}

      <header className="flex items-start gap-3.5 px-4 pt-4 md:px-5 md:pt-5">
        <VerdictTile tone={tone} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] leading-6 font-semibold tracking-[-0.01em] text-balance text-ink">
            {stale && !headline ? `Last known: ${String(title).toLowerCase()}` : title}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-[18px] text-ink-2">
            <span className={cn("font-medium", stale ? "text-ink-3" : TONE_TEXT[tone])}>
              {stale ? lastKnown(meta.label) : meta.label}
            </span>
            {conf != null && (
              <>
                <Sep />
                <span>
                  <span className="pg-mono">{conf}%</span> sure
                </span>
              </>
            )}
            {where && (
              <span className="inline-flex items-center gap-x-2 max-sm:hidden">
                <Sep />
                <span className="pg-mono text-[12px]">{where}</span>
              </span>
            )}
            {r.bird_age_days != null && (
              <>
                <Sep />
                <span>
                  Day {Math.round(r.bird_age_days)}
                  {phase ? `, ${phase.toLowerCase()}` : ""}
                </span>
              </>
            )}
            {/* Phones: the clock column is hidden, so say how fresh it is on its own line. */}
            <span className="basis-full text-[12px] leading-4 text-ink-3 sm:hidden">
              {fresh.caption}
            </span>
          </p>
        </div>
        <time
          dateTime={new Date(r.created_at).toISOString()}
          title={formatDateTime(r.created_at)}
          className="shrink-0 text-right max-sm:hidden"
        >
          <span className="pg-mono block text-[15px] leading-5 text-ink">
            {formatTime(r.created_at)}
          </span>
          <span className="block text-[12px] leading-4 text-ink-3">{fresh.caption}</span>
        </time>
      </header>

      {top?.advice ? (
        <div className="px-4 pt-3 pb-4 md:px-5 md:pl-[76px]">
          <p className="max-w-[68ch] text-[14px] leading-5 text-ink">
            <span className="font-semibold">{stale ? "Advice then: " : "Do this: "}</span>
            {top.advice}
          </p>
          {others.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1.5 text-[12px] leading-4 text-ink-2">
              <span className="py-0.5 text-ink-3">Also</span>
              {others.map((c) => (
                <span
                  key={c.id}
                  className="rounded-[var(--pg-r-chip)] border border-hairline bg-sunken px-1.5 py-0.5"
                  title={c.advice}
                >
                  {c.label} <span className="pg-mono text-ink-3">{Math.round(c.prob * 100)}%</span>
                </span>
              ))}
            </p>
          )}
        </div>
      ) : (
        <div className="pb-4" />
      )}

      {r.temperature != null && r.target_temp != null && (
        <div className="border-t border-hairline px-4 pt-3 pb-1 md:px-5">
          <ComfortScale
            temperature={r.temperature}
            target={r.target_temp}
            ageDays={r.bird_age_days}
            stale={stale}
          />
        </div>
      )}

      <SensorGauges
        className="border-t border-hairline"
        humidity={r.humidity}
        gas={r.gas_index}
        light={r.light}
        fanOn={r.fan_on}
        stale={stale}
        health={health}
      />

      {children}

      {showModel && r.ai_probabilities && (
        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-hairline bg-sunken/50 px-4 py-2.5 md:px-5">
          <span className="pg-t-caption inline-flex items-center gap-1.5 max-sm:hidden">
            <Cpu className="size-3" aria-hidden />
            <span className="pg-mono">{r.model_version ?? "edge model"}</span> on the Pi
          </span>
          <ul
            className="m-0 flex list-none gap-3 p-0 text-[12px] leading-4 text-ink-2"
            aria-label="Model output"
          >
            {(["healthy", "warning", "critical"] as const).map((k) => (
              <li key={k} className="inline-flex items-center gap-1">
                <SeverityMark tone={stale ? "off" : statusTone(k)} className="size-2.5" />
                {STATUS_META[k].label}
                <span className="pg-mono text-ink">
                  {Math.round((r.ai_probabilities![k] ?? 0) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </section>
  );
}

function Sep() {
  return (
    <span aria-hidden className="text-ink-disabled">
      ·
    </span>
  );
}

const TONE_TEXT = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  off: "text-ink-3",
} as const;

/** Kept for existing callers; prefer `formatRelative` / `RelativeTime` from ui-kit. */
export function timeAgo(iso: string) {
  return formatRelative(iso);
}
