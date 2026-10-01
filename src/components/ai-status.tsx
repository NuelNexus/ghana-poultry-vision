import { Fan, Sprout, ShieldCheck, ShieldAlert, ShieldX, Cpu } from "lucide-react";
import type { AiSnapshot, AiStatus, Reading } from "@/lib/api/types";
import { Badge } from "@/components/ui-kit";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<
  AiStatus,
  {
    label: string;
    tone: "success" | "warning" | "destructive";
    icon: typeof ShieldCheck;
    color: string;
  }
> = {
  healthy: { label: "Healthy", tone: "success", icon: ShieldCheck, color: "#16a34a" },
  warning: { label: "Warning", tone: "warning", icon: ShieldAlert, color: "#d97706" },
  critical: { label: "Critical", tone: "destructive", icon: ShieldX, color: "#dc2626" },
};

export const PHASE_LABEL: Record<string, string> = {
  brooding: "Brooding (week 1)",
  starter: "Starter (wk 2–3)",
  grower: "Grower (wk 4–5)",
  finisher: "Finisher (wk 6+)",
};

export function AiStatusBadge({ status }: { status: AiStatus | null | undefined }) {
  if (!status) return <Badge>No AI data</Badge>;
  return <Badge tone={STATUS_META[status].tone}>{STATUS_META[status].label}</Badge>;
}

export function isStale(r: { created_at: string } | null | undefined, ms = 5 * 60_000) {
  return !r || Date.now() - new Date(r.created_at).getTime() > ms;
}

/** Big status panel for one device's latest edge-AI reading. */
export function AiStatusPanel({
  r,
  compact = false,
}: {
  r: AiSnapshot | Reading;
  compact?: boolean;
}) {
  const status = r.ai_status ?? "healthy";
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const stale = isStale(r);
  const where = "house_name" in r ? (r.house_name ?? r.device_code) : null;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div
        className="flex items-center gap-4 p-5"
        style={{ background: `${meta.color}14`, borderBottom: `3px solid ${meta.color}` }}
      >
        <div
          className="h-14 w-14 rounded-full flex items-center justify-center shrink-0"
          style={{ background: meta.color }}
        >
          <Icon className="h-7 w-7 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {where ? `${where} · ` : ""}Coop condition
          </div>
          <div className="text-2xl font-semibold" style={{ color: meta.color }}>
            {meta.label}
          </div>
          <div className="text-xs text-muted-foreground">
            {r.ai_confidence != null && `${Math.round(r.ai_confidence * 100)}% confident · `}
            {stale ? (
              <span className="text-destructive">last update {timeAgo(r.created_at)}</span>
            ) : (
              `updated ${timeAgo(r.created_at)}`
            )}
          </div>
        </div>
      </div>

      <div className={cn("grid gap-3 p-5", compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4")}>
        <Mini
          icon={Sprout}
          label="Growth phase"
          value={r.growth_phase ? (PHASE_LABEL[r.growth_phase] ?? r.growth_phase) : "—"}
          hint={
            r.bird_age_days != null
              ? `Day ${Math.round(r.bird_age_days)} · target ${r.target_temp ?? "—"}°C`
              : undefined
          }
        />
        <Mini
          icon={Fan}
          label="Fan"
          value={r.fan_level ? r.fan_level[0].toUpperCase() + r.fan_level.slice(1) : "—"}
          hint={r.fan_rpm != null ? `${Math.round(r.fan_rpm)} rpm` : undefined}
        />
        {!compact && (
          <>
            <Mini
              label="Temp / humidity"
              value={`${r.temperature ?? "—"}°C · ${r.humidity ?? "—"}%`}
            />
            <Mini
              label="Gas index (MQ-135)"
              value={r.gas_index != null ? String(r.gas_index) : "—"}
              hint={
                r.gas_index != null
                  ? r.gas_index >= 22
                    ? "High"
                    : r.gas_index >= 14
                      ? "Elevated"
                      : "Normal"
                  : undefined
              }
            />
          </>
        )}
      </div>

      {status !== "healthy" && r.ai_causes && r.ai_causes.length > 0 && (
        <div className="px-5 pb-5 space-y-2">
          {r.ai_causes.map((c) => (
            <div key={c.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{c.label}</span>
                <span className="text-xs text-muted-foreground">{Math.round(c.prob * 100)}%</span>
              </div>
              {c.advice && !compact && (
                <div className="text-xs text-muted-foreground mt-1">{c.advice}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {!compact && r.ai_probabilities && (
        <div className="px-5 pb-5">
          <div className="flex h-2 rounded-full overflow-hidden">
            {(["healthy", "warning", "critical"] as const).map((k) => (
              <div
                key={k}
                style={{
                  width: `${(r.ai_probabilities![k] ?? 0) * 100}%`,
                  background: STATUS_META[k].color,
                }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
            {(["healthy", "warning", "critical"] as const).map((k) => (
              <span key={k}>
                {STATUS_META[k].label} {Math.round((r.ai_probabilities![k] ?? 0) * 100)}%
              </span>
            ))}
          </div>
          {r.model_version && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-2">
              <Cpu className="h-3 w-3" /> {r.model_version} on Raspberry Pi
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Mini({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon?: typeof Fan;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md bg-muted/40 p-3 min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className="mt-1 font-semibold text-sm truncate">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground truncate">{hint}</div>}
    </div>
  );
}

export function timeAgo(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
