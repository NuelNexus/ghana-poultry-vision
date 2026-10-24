import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, AlertTriangle, Check, Info, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { listAlerts, resolveAlert } from "@/lib/api/farm.functions";
import type { Alert } from "@/lib/api/types";
import {
  Button,
  EmptyState,
  Modal,
  PageHeader,
  QueryState,
  RelativeTime,
  SegmentedControl,
  Select,
  SkeletonRows,
  StatusPill,
  Toolbar,
  ToolbarSpacer,
  formatDate,
  formatTime,
  type Status,
} from "@/components/ui-kit";
import { SeverityMark } from "@/components/coop-readout";
import { cn } from "@/lib/utils";

const STATES = ["open", "resolved", "all"] as const;
const SEVERITIES = ["all", "critical", "warning", "info"] as const;
type StateFilter = (typeof STATES)[number];
type SeverityFilter = (typeof SEVERITIES)[number];
type AlertsSearch = { status?: StateFilter; severity?: SeverityFilter };

export const Route = createFileRoute("/app/alerts")({
  validateSearch: (s: Record<string, unknown>): AlertsSearch => ({
    status: STATES.includes(s.status as StateFilter) ? (s.status as StateFilter) : undefined,
    severity: SEVERITIES.includes(s.severity as SeverityFilter)
      ? (s.severity as SeverityFilter)
      : undefined,
  }),
  component: Alerts,
});

const SEV: Record<
  Alert["severity"],
  { label: string; status: Status; icon: LucideIcon; rule: string; rank: number }
> = {
  critical: { label: "Critical", status: "crit", icon: AlertOctagon, rule: "bg-crit", rank: 0 },
  warning: { label: "Warning", status: "warn", icon: AlertTriangle, rule: "bg-warn", rank: 1 },
  info: { label: "Info", status: "info", icon: Info, rule: "bg-info", rank: 2 },
};

/** Alerts are only raised by the Pi's edge AI (type "ai", see devices/ingest). */
const SOURCE: Record<string, string> = {
  ai: "Edge AI",
};

function sourceLabel(type: string) {
  if (SOURCE[type]) return SOURCE[type];
  const s = type.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Alert";
}

/**
 * Edge alerts arrive as "main: Warning: Heat stress. Fan set to medium."
 * Split off the device prefix and the repeated severity word; the row shows both already.
 */
function parseMessage(msg: string) {
  const m = /^\s*([^:]{1,40}):\s*(?:healthy|warning|critical|info)\s*:\s*(.+)$/is.exec(msg);
  if (!m) return { where: null, text: msg };
  return { where: m[1].trim(), text: m[2].trim() };
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const diff = Math.round((start.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return formatDate(iso);
}

function Alerts() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const state: StateFilter = search.status ?? "open";
  const severity: SeverityFilter = search.severity ?? "all";
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [confirmAll, setConfirmAll] = useState(false);
  const [bulk, setBulk] = useState(false);

  const q = useQuery({
    queryKey: ["alerts-all"],
    queryFn: () => listAlerts(),
    refetchInterval: 10_000,
  });

  const all = q.data ?? [];
  const open = all.filter((a) => !a.resolved);
  const counts = {
    open: open.length,
    resolved: all.length - open.length,
    all: all.length,
  };
  const critOpen = open.filter((a) => a.severity === "critical").length;

  const shown = all
    .filter((a) => (state === "open" ? !a.resolved : state === "resolved" ? !!a.resolved : true))
    .filter((a) => severity === "all" || a.severity === severity)
    .sort(
      (a, b) =>
        // Open first, then newest. Severity is shown, not sorted, so time order stays honest.
        Number(!!a.resolved) - Number(!!b.resolved) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  const shownOpen = shown.filter((a) => !a.resolved && !pending.has(a.id));

  const groups: { day: string; items: Alert[] }[] = [];
  for (const a of shown) {
    const day = dayLabel(a.created_at);
    const g = groups[groups.length - 1];
    if (g?.day === day) g.items.push(a);
    else groups.push({ day, items: [a] });
  }

  const setSearch = (patch: AlertsSearch) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  function markResolved(ids: string[]) {
    qc.setQueryData<Alert[]>(["alerts-all"], (old) =>
      old?.map((a) => (ids.includes(a.id) ? { ...a, resolved: true } : a)),
    );
  }

  async function resolve(a: Alert) {
    setPending((p) => new Set(p).add(a.id));
    try {
      await resolveAlert({ data: { id: a.id } });
      markResolved([a.id]);
      toast.success("Alert resolved", { description: parseMessage(a.message).text.slice(0, 80) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t resolve the alert");
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(a.id);
        return n;
      });
      void qc.invalidateQueries({ queryKey: ["alerts-all"] });
    }
  }

  async function resolveShown() {
    const ids = shownOpen.map((a) => a.id);
    setBulk(true);
    const results = await Promise.allSettled(ids.map((id) => resolveAlert({ data: { id } })));
    const ok = ids.filter((_, i) => results[i].status === "fulfilled");
    markResolved(ok);
    setBulk(false);
    setConfirmAll(false);
    if (ok.length === ids.length) toast.success(`${ok.length} alerts resolved`);
    else toast.error(`${ids.length - ok.length} of ${ids.length} alerts couldn’t be resolved`);
    void qc.invalidateQueries({ queryKey: ["alerts-all"] });
  }

  const sevLabel = severity === "all" ? "" : `${SEV[severity].label.toLowerCase()} `;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="mb-2 md:mb-2"
        title="Alerts"
        meta={
          q.data ? (
            <>
              <span>
                <span className="pg-mono text-ink-2">{counts.open}</span> open
              </span>
              {critOpen > 0 && (
                <span className="font-medium text-crit">
                  <span className="pg-mono">{critOpen}</span> critical
                </span>
              )}
              <span>
                <span className="pg-mono text-ink-2">{counts.resolved}</span> resolved
              </span>
            </>
          ) : undefined
        }
      />

      <div>
        <Toolbar>
          <SegmentedControl
            ariaLabel="Alert state"
            value={state}
            onChange={(v) => setSearch({ status: v === "open" ? undefined : v })}
            options={STATES.map((s) => ({
              value: s,
              label: (
                <>
                  {s[0].toUpperCase() + s.slice(1)}
                  {q.data && (
                    <span className="pg-mono ml-1.5 text-[11px] text-ink-3">{counts[s]}</span>
                  )}
                </>
              ),
            }))}
          />
          <label className="flex items-center gap-2">
            <span className="sr-only">Severity</span>
            <Select
              name="severity"
              value={severity}
              onChange={(e) =>
                setSearch({
                  severity:
                    e.target.value === "all" ? undefined : (e.target.value as SeverityFilter),
                })
              }
              className="h-9 w-auto min-w-[148px] py-0"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </Select>
          </label>
          <ToolbarSpacer />
          {shownOpen.length > 1 && (
            <Button size="sm" variant="ghost" icon={Check} onClick={() => setConfirmAll(true)}>
              Resolve {shownOpen.length} shown
            </Button>
          )}
        </Toolbar>

        <QueryState
          query={q}
          loading={<SkeletonRows rows={4} cols={3} />}
          errorTitle="Couldn’t load alerts"
        >
          {() =>
            shown.length === 0 ? (
              <EmptyState
                title={
                  state === "open"
                    ? `No open ${sevLabel}alerts`
                    : state === "resolved"
                      ? `No resolved ${sevLabel}alerts`
                      : `No ${sevLabel}alerts`
                }
                description={
                  state === "open" && severity === "all"
                    ? "Every alert has been dealt with. New warnings from the edge AI and device checks appear here as they happen."
                    : "Nothing matches these filters."
                }
                secondary={
                  state === "open" && counts.resolved > 0 ? (
                    <Button size="sm" onClick={() => setSearch({ status: "resolved" })}>
                      View resolved
                    </Button>
                  ) : severity !== "all" ? (
                    <Button size="sm" onClick={() => setSearch({ severity: undefined })}>
                      Show all severities
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="pg-panel overflow-hidden">
                {groups.map((g) => (
                  <section key={g.day} aria-label={g.day}>
                    <h2 className="pg-t-micro border-b border-hairline bg-sunken px-4 py-2 md:px-5">
                      {g.day}
                    </h2>
                    <ul>
                      {g.items.map((a) => (
                        <AlertRow
                          key={a.id}
                          a={a}
                          pending={pending.has(a.id) || (bulk && !a.resolved)}
                          onResolve={() => void resolve(a)}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )
          }
        </QueryState>
      </div>

      <Modal
        open={confirmAll}
        onOpenChange={(v) => !bulk && setConfirmAll(v)}
        title={`Resolve ${shownOpen.length} alerts?`}
        description="They move to Resolved for everyone on the farm. This can’t be undone."
        footer={
          <>
            <Button onClick={() => setConfirmAll(false)} disabled={bulk}>
              Cancel
            </Button>
            <Button variant="primary" loading={bulk} onClick={() => void resolveShown()}>
              Resolve {shownOpen.length}
            </Button>
          </>
        }
      >
        <ul className="max-h-60 overflow-y-auto overscroll-contain text-[13px] leading-[18px]">
          {shownOpen.map((a) => (
            <li
              key={a.id}
              className="flex items-baseline gap-2 border-t border-hairline py-2 first:border-t-0"
            >
              <StatusPill status={SEV[a.severity].status} size="sm">
                {SEV[a.severity].label}
              </StatusPill>
              <span className="min-w-0 truncate text-ink-2">{parseMessage(a.message).text}</span>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

function AlertRow({
  a,
  pending,
  onResolve,
}: {
  a: Alert;
  pending: boolean;
  onResolve: () => void;
}) {
  const sev = SEV[a.severity] ?? SEV.info;
  const resolved = !!a.resolved;
  const { where, text } = parseMessage(a.message);
  const tone = resolved
    ? "off"
    : sev.status === "crit"
      ? "crit"
      : sev.status === "warn"
        ? "warn"
        : "off";
  return (
    <li className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 gap-y-3 border-t border-hairline px-4 py-3.5 first:border-t-0 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto] md:px-5">
      <div className="flex flex-col items-start gap-1.5 pt-0.5">
        <time
          dateTime={new Date(a.created_at).toISOString()}
          className="pg-mono text-[13px] leading-[18px] text-ink-2"
        >
          {formatTime(a.created_at)}
        </time>
        <SeverityMark tone={tone} />
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "text-[14px] leading-5 text-pretty break-words",
            resolved ? "text-ink-3" : "text-ink",
          )}
        >
          <span
            className={cn(
              "font-semibold",
              resolved
                ? "text-ink-3"
                : sev.status === "crit"
                  ? "text-crit"
                  : sev.status === "warn"
                    ? "text-warn"
                    : "text-info",
            )}
          >
            {sev.label}
          </span>{" "}
          {text}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 text-ink-3">
          <span className="max-sm:hidden">{sourceLabel(a.type)}</span>
          {where && (
            <>
              <span aria-hidden className="text-ink-disabled max-sm:hidden">
                ·
              </span>
              <span className="pg-mono">{where}</span>
            </>
          )}
          <span aria-hidden className="text-ink-disabled">
            ·
          </span>
          <RelativeTime iso={a.created_at} />
          {a.device_id && (
            <>
              <span aria-hidden className="text-ink-disabled">
                ·
              </span>
              <Link
                to="/app/health"
                search={{ device: a.device_id }}
                className="font-medium text-brand underline decoration-brand/30 underline-offset-4 transition-colors hover:decoration-brand"
              >
                Flock health
              </Link>
            </>
          )}
        </p>
      </div>
      <div className="col-start-2 shrink-0 sm:col-start-auto sm:pt-0.5">
        {resolved ? (
          <StatusPill status="ok" size="sm">
            Resolved
          </StatusPill>
        ) : (
          <Button size="sm" icon={Check} loading={pending} onClick={onResolve}>
            {pending ? "Resolving…" : "Resolve"}
          </Button>
        )}
      </div>
    </li>
  );
}
