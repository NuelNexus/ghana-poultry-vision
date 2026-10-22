import { Cpu, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { FRESHNESS_MS, type AiSnapshot, type AiStatus, type Reading } from "@/lib/api/types";
import {
  StatusPill,
  UNITS,
  formatDateTime,
  formatFan,
  formatNumber,
  formatRelative,
  formatTemp,
  formatUnit,
  freshness,
  lastKnown,
  useDisplayPrefs,
  useNow,
  type Status,
} from "@/components/ui-kit";
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

function gasWord(g: number) {
  return g >= 22 ? "High" : g >= 14 ? "Elevated" : "Normal";
}

/**
 * Status panel for one device's latest edge-AI reading.
 * `eyebrow={false}` drops the small "main · Coop condition" label (use it on pages
 * whose title already says this, e.g. Flock health).
 */
export function AiStatusPanel({
  r,
  compact = false,
  eyebrow = true,
}: {
  r: AiSnapshot | Reading;
  compact?: boolean;
  eyebrow?: boolean;
}) {
  const now = useNow(15_000);
  useDisplayPrefs();
  const status = r.ai_status ?? "healthy";
  const meta = STATUS_META[status];
  const fresh = freshness(r.created_at, now);
  const stale = fresh.state === "stale" || fresh.state === "none";
  const where = "house_name" in r ? (r.house_name ?? r.device_code) : null;
  const conf = r.ai_confidence != null ? Math.round(r.ai_confidence * 100) : null;
  const causes = status !== "healthy" && r.ai_causes ? r.ai_causes : [];

  const cells: { label: string; value: string; sub?: string }[] = [
    {
      label: "Growth phase",
      value: r.growth_phase ? (PHASE_LABEL[r.growth_phase] ?? r.growth_phase) : "—",
      sub:
        r.bird_age_days != null
          ? `Day ${Math.round(r.bird_age_days)}${r.target_temp != null ? ` · target ${formatTemp(r.target_temp)}` : ""}`
          : undefined,
    },
    {
      label: "Fan",
      value: formatFan(r.fan_level),
      sub: r.fan_rpm != null ? formatUnit(Math.round(r.fan_rpm), UNITS.rpm, 0) : undefined,
    },
  ];
  if (!compact) {
    cells.push(
      {
        label: "Temperature",
        value: formatTemp(r.temperature),
        sub: r.humidity != null ? formatUnit(r.humidity, UNITS.rh) : undefined,
      },
      {
        label: "Gas index (MQ-135)",
        value: r.gas_index != null ? formatNumber(r.gas_index) : "—",
        sub: r.gas_index != null ? gasWord(r.gas_index) : undefined,
      },
    );
  }

  return (
    <section
      className={cn("pg-panel overflow-hidden", stale && "bg-[var(--pg-hover)]")}
      aria-label={`${where ? where + " " : ""}coop condition`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 md:px-5">
        <div className="min-w-0">
          {eyebrow && <div className="pg-t-micro">{where ? `${where} · ` : ""}Coop condition</div>}
          <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", eyebrow && "mt-1.5")}>
            {stale ? (
              <StatusPill status="offline">{lastKnown(meta.label)}</StatusPill>
            ) : (
              <StatusPill status={meta.status}>{meta.label}</StatusPill>
            )}
            {conf != null && (
              <span
                className={cn("text-[13px] leading-[18px]", stale ? "text-ink-3" : "text-ink-2")}
              >
                <span className="pg-num">{formatUnit(conf, UNITS.pct, 0)}</span> confidence
              </span>
            )}
          </div>
        </div>
        <time
          dateTime={new Date(r.created_at).toISOString()}
          title={formatDateTime(r.created_at)}
          className="pg-t-caption pt-0.5"
        >
          {fresh.caption}
        </time>
      </div>

      {stale && (
        <p className="pg-t-caption mt-1.5 px-4 md:px-5">
          Pi reported {formatDateTime(r.created_at)} · check its power and network
        </p>
      )}

      {/* Readings */}
      <dl
        className={cn(
          "mt-4 grid border-t border-hairline",
          compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4",
        )}
      >
        {cells.map((c, i) => (
          <div
            key={c.label}
            className={cn(
              "min-w-0 px-4 py-3 md:px-5",
              i % 2 === 1 && "border-l border-hairline",
              !compact && i >= 2 && "border-t border-hairline md:border-t-0",
              !compact && i > 0 && "md:border-l",
            )}
          >
            <dt className="text-[12px] leading-4 text-ink-3">{c.label}</dt>
            <dd
              className={cn(
                "mt-1 truncate text-[14px] leading-5 font-medium",
                stale ? "text-ink-2" : "text-ink",
              )}
            >
              {c.value}
            </dd>
            {c.sub && <dd className="pg-num truncate text-[12px] leading-4 text-ink-3">{c.sub}</dd>}
          </div>
        ))}
      </dl>

      {/* Likely causes: a left rule by state, not a fake checkbox */}
      {causes.length > 0 && (
        <div className="border-t border-hairline px-4 py-3 md:px-5">
          <h3 className="pg-t-label mb-2">{stale ? "Causes at last reading" : "Likely causes"}</h3>
          <ul className="space-y-2">
            {(compact ? causes.slice(0, 1) : causes).map((c) => (
              <li
                key={c.id}
                className={cn(
                  "border-l-2 pl-3",
                  stale
                    ? "border-line-strong"
                    : status === "critical"
                      ? "border-crit"
                      : "border-warn",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[14px] leading-5 font-medium text-ink">{c.label}</span>
                    <span className="pg-num shrink-0 text-[12px] text-ink-3">
                      {formatUnit(Math.round(c.prob * 100), UNITS.pct, 0)}
                    </span>
                  </div>
                  {c.advice && !compact && (
                    <p className="mt-0.5 text-[13px] leading-[18px] text-ink-2">{c.advice}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Probability split: segmented meter with labels (not colour-only) */}
      {!compact && r.ai_probabilities && (
        <div className="border-t border-hairline px-4 py-3 md:px-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="pg-t-label">Model output</h3>
            {r.model_version && (
              <span className="pg-t-caption inline-flex items-center gap-1">
                <Cpu className="size-3" aria-hidden />
                <span className="pg-mono">{r.model_version}</span> on Raspberry Pi
              </span>
            )}
          </div>
          <div
            className={cn(
              "mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full",
              stale && "opacity-50",
            )}
            aria-hidden
          >
            {(["healthy", "warning", "critical"] as const).map((k) => {
              const p = r.ai_probabilities![k] ?? 0;
              return p > 0 ? (
                <div key={k} style={{ width: `${p * 100}%`, background: STATUS_META[k].color }} />
              ) : null;
            })}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-4 text-ink-2">
            {(["healthy", "warning", "critical"] as const).map((k) => (
              <li key={k} className="inline-flex items-center gap-1.5">
                <span className="pg-dot" style={{ color: STATUS_META[k].color }} aria-hidden />
                {STATUS_META[k].label}
                <span className="pg-num text-ink">
                  {formatUnit(Math.round((r.ai_probabilities![k] ?? 0) * 100), UNITS.pct, 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Kept for existing callers; prefer `formatRelative` / `RelativeTime` from ui-kit. */
export function timeAgo(iso: string) {
  return formatRelative(iso);
}
