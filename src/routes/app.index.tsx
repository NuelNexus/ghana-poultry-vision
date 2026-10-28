import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Cpu } from "lucide-react";
import type { ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getDashboard, listHouses } from "@/lib/api/farm.functions";
import { FarmScene } from "@/components/FarmScene";
import { FlockCareCard } from "@/components/FlockCareCard";
import type { AiSnapshot, Alert, House, Reading } from "@/lib/api/types";
import { AiStatusBadge, AiStatusPanel, STATUS_META, isStale } from "@/components/ai-status";
import { RelaySwitch, SeverityMark } from "@/components/coop-readout";
import {
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  DataTable,
  EmptyState,
  ErrorState,
  Freshness,
  Metric,
  MetricGrid,
  PageHeader,
  RelativeTime,
  Section,
  Skeleton,
  SkeletonRows,
  SkeletonText,
  StatusPill,
  buttonClass,
  chartColors,
  formatDateTime,
  formatFan,
  formatNumber,
  formatRelative,
  formatTemp,
  formatTempDelta,
  formatTime,
  gridProps,
  lineProps,
  targetBandProps,
  tempUnit,
  toTemp,
  toTempDelta,
  tooltipCursor,
  useNow,
  xAxisProps,
  yAxisProps,
  type Status,
} from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/")({
  component: Overview,
});

const NBSP = String.fromCharCode(160);
/** Broiler house relative-humidity comfort range. */
const RH_TARGET: [number, number] = [50, 70];
/** Band drawn around the age-based temperature target from the Pi. */
const TEMP_BAND = 1;

const rank = (s: string | null | undefined) => (s === "critical" ? 2 : s === "warning" ? 1 : 0);
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${formatNumber(Math.abs(n))}`;
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const lastWith = <T, K extends keyof T>(rows: T[], key: K) =>
  [...rows].reverse().find((r) => r[key] != null);

// Gas index above this is worth ventilating for (same line as Flock health).
const GAS_HIGH = 22;

function Overview() {
  const now = useNow(15_000);
  // Neon has no realtime channel; poll instead (the Pi reports every 30 s).
  const dash = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(),
    refetchInterval: 10_000,
  });
  const houses = useQuery({
    queryKey: ["houses"],
    queryFn: () => listHouses(),
    refetchInterval: 15_000,
  });

  const d = dash.data;
  const history = d?.history ?? [];
  const ai = (d?.ai ?? [])
    .slice()
    .sort(
      (a, b) => rank(b.ai_status) - rank(a.ai_status) || b.created_at.localeCompare(a.created_at),
    );
  // The Pi's newest report (gas, light and fan only come from here).
  const latestAi = (d?.ai ?? []).reduce<AiSnapshot | undefined>(
    (a, b) => (!a || b.created_at > a.created_at ? b : a),
    undefined,
  );
  const lastReadingAt = history.length ? history[history.length - 1].created_at : null;
  const live = !!lastReadingAt && !isStale({ created_at: lastReadingAt });
  // Age-based target from the Pi (numeric columns can arrive as strings).
  const target = num(ai.find((r) => r.target_temp != null)?.target_temp);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        className="mb-0 md:mb-0"
        title="Overview"
        meta={
          dash.isPending ? (
            <Skeleton className="h-3.5 w-48" />
          ) : (
            <Freshness at={lastReadingAt} variant="caption" />
          )
        }
      >
        <Link
          to="/app/health"
          className={cn(buttonClass({ variant: "secondary" }), "max-md:hidden")}
        >
          Flock health
          <ArrowRight aria-hidden strokeWidth={1.75} />
        </Link>
      </PageHeader>

      <FarmScene />

      {dash.isError ? (
        <ErrorState
          title="Couldn’t load the overview"
          error={dash.error}
          onRetry={() => void dash.refetch()}
        />
      ) : (
        <>
          <FlockCondition loading={dash.isPending} ai={ai} now={now} />

          <FlockCareCard />

          <KeyMetrics
            loading={dash.isPending}
            stats={d?.stats}
            history={history}
            target={target}
            houses={houses}
            latest={latestAi}
            alerts={d?.recentAlerts ?? []}
            now={now}
          />

          <Trends
            loading={dash.isPending}
            history={history}
            target={target}
            live={live}
            now={now}
          />

          <div className="grid gap-8 xl:grid-cols-5 xl:gap-4">
            <HousesSummary query={houses} className="xl:col-span-3" />
            <RecentAlerts
              loading={dash.isPending}
              alerts={d?.recentAlerts ?? []}
              openCount={d?.stats.activeAlerts ?? 0}
              className="xl:col-span-2"
            />
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * 1. Flock condition: "is my flock OK right now?"
 * -------------------------------------------------------------------------- */

function FlockCondition({ loading, ai, now }: { loading: boolean; ai: AiSnapshot[]; now: number }) {
  if (loading) {
    return (
      <section aria-label="Flock condition" className="pg-panel" role="status">
        <div className="px-4 py-4 md:px-5 md:py-5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-3 h-6 w-72 max-w-full" />
          <Skeleton className="mt-2 h-3.5 w-96 max-w-full" />
        </div>
        <div className="border-t border-hairline px-4 py-4 md:px-5">
          <SkeletonText lines={2} />
        </div>
      </section>
    );
  }

  if (ai.length === 0) {
    return (
      <EmptyState
        icon={Cpu}
        title="No edge device has reported yet"
        description="Once a Raspberry Pi is registered and its agent is running, each house’s condition, likely causes and suggested actions appear here."
        action={
          <Link to="/app/devices" className={buttonClass({ variant: "primary" })}>
            Go to devices
          </Link>
        }
      />
    );
  }

  const worst = ai[0];
  const meta = STATUS_META[worst.ai_status ?? "healthy"];
  const where = worst.house_name ?? worst.device_code;
  const cause = worst.ai_status !== "healthy" ? worst.ai_causes?.[0] : undefined;
  const attention = ai.filter((r) => !isStale(r) && r.ai_status !== "healthy").length;

  // One Pi: the readout's own title (the top cause) says it best. Several: sum them up.
  const headline =
    ai.length === 1
      ? undefined
      : worst.ai_status === "healthy"
        ? isStale(worst)
          ? "Last known condition was healthy"
          : "All monitored houses look healthy"
        : attention > 1
          ? `${attention} houses need attention`
          : `${cause ? cause.label : meta.label} in ${where}`;

  return (
    <AiStatusPanel r={worst} headline={headline} showModel={false}>
      {ai.length > 1 && (
        <div className="border-t border-hairline bg-surface">
          <DataTable
            bare
            caption="Edge devices"
            rows={ai}
            rowKey={(r) => r.device_id}
            columns={[
              {
                key: "where",
                header: "Location",
                mobile: "title",
                cell: (r) => (
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-ink">
                      {r.house_name ?? "Unassigned"}
                    </span>
                    <span className="pg-mono truncate text-[12px] leading-4 text-ink-3">
                      {r.device_code}
                    </span>
                  </span>
                ),
              },
              {
                key: "status",
                header: "Condition",
                mobile: "status",
                cell: (r) => <AiStatusBadge status={r.ai_status} at={r.created_at} />,
              },
              {
                key: "temp",
                header: "Temp vs target",
                align: "right",
                cell: (r) => <TempVsTarget r={r} />,
              },
              {
                key: "rh",
                header: "Humidity",
                align: "right",
                cell: (r) => <Num v={r.humidity} unit="%" muted={isStale(r)} />,
              },
              {
                key: "gas",
                header: "Gas index",
                align: "right",
                mobile: "hide",
                cell: (r) => <Num v={r.gas_index} muted={isStale(r)} />,
              },
              {
                key: "fan",
                header: "Fan",
                cell: (r) =>
                  r.fan_on == null ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <RelaySwitch on={r.fan_on} stale={isStale(r)} />
                      <span className={isStale(r) ? "text-ink-3" : "text-ink"}>
                        {formatFan(r.fan_on)}
                      </span>
                    </span>
                  ),
              },
              {
                key: "seen",
                header: "Last reading",
                align: "right",
                cell: (r) => <RelativeTime iso={r.created_at} className="text-ink-2" />,
              },
            ]}
          />
        </div>
      )}
    </AiStatusPanel>
  );
}

function Num({ v, unit, muted }: { v: number | null | undefined; unit?: string; muted?: boolean }) {
  if (v == null) return <span className="text-ink-3">—</span>;
  return (
    <span className={cn("pg-mono", muted ? "text-ink-2" : "text-ink")}>
      {formatNumber(v)}
      {unit && <span className="ml-0.5 text-ink-3">{unit}</span>}
    </span>
  );
}

function TempVsTarget({ r }: { r: Reading }) {
  if (r.temperature == null) return <span className="text-ink-3">—</span>;
  const stale = isStale(r);
  const diff = r.target_temp != null ? r.temperature - r.target_temp : null;
  const off = diff != null && Math.abs(diff) > 2;
  return (
    <span className="inline-flex items-baseline gap-2">
      <Num v={toTemp(r.temperature)} unit={tempUnit()} muted={stale} />
      {diff != null && (
        <span
          className={cn(
            "pg-mono text-[12px]",
            stale ? "text-ink-3" : off ? "text-warn" : "text-ink-3",
          )}
          title={`Target ${formatTemp(r.target_temp)}`}
        >
          {signed(toTempDelta(diff)!)}
        </span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- *
 * 2. Key metrics strip
 * -------------------------------------------------------------------------- */

type Q<T> = { data: T | undefined; isPending: boolean; isError: boolean };
type Stats = NonNullable<Awaited<ReturnType<typeof getDashboard>>>["stats"];

function KeyMetrics({
  loading,
  stats,
  history,
  target,
  houses,
  latest,
  alerts,
  now,
}: {
  loading: boolean;
  stats: Stats | undefined;
  history: { temperature: number | null; humidity: number | null; created_at: string }[];
  target: number | null;
  houses: Q<Awaited<ReturnType<typeof listHouses>>>;
  latest: AiSnapshot | undefined;
  alerts: Alert[];
  now: number;
}) {
  // Climate: the latest real reading (the server's averages turn "no data" into 0).
  const t = lastWith(history, "temperature");
  const h = lastWith(history, "humidity");
  const tStale = !t || isStale(t);
  const hStale = !h || isStale(h);
  const tDiff = t?.temperature != null && target != null ? t.temperature - target : null;

  // Birds
  const houseList = houses.data?.houses ?? [];
  const birds = houseList.reduce((s, x) => s + (x.bird_count ?? 0), 0);

  // Gas (MQ-135) and fan come from the Pi's newest report.
  const lStale = !latest || isStale(latest);
  const gas = latest?.gas_index ?? null;

  const openAlerts = stats?.activeAlerts ?? 0;
  const openCritical = alerts.some((a) => !a.resolved && a.severity === "critical");
  const latestOpen = alerts.find((a) => !a.resolved);

  const ago = (iso: string) => formatRelative(iso, now);

  return (
    <Section title="Today at a glance">
      <MetricGrid cols={6}>
        <Metric
          label="Birds"
          loading={houses.isPending}
          value={houseList.length ? formatNumber(birds, { maximumFractionDigits: 0 }) : null}
          sub={
            houses.isError
              ? "Couldn’t load houses"
              : houseList.length
                ? `in ${houseList.length} ${houseList.length === 1 ? "house" : "houses"}`
                : "No houses yet"
          }
        />
        <Metric
          className="max-md:hidden"
          label="Temperature"
          loading={loading}
          status={
            t
              ? tStale
                ? "offline"
                : tDiff != null && Math.abs(tDiff) > 2
                  ? "warn"
                  : "ok"
              : undefined
          }
          value={t?.temperature != null ? formatNumber(toTemp(t.temperature)) : null}
          unit={tempUnit()}
          delta={
            tDiff != null && !tStale
              ? {
                  value: formatTempDelta(tDiff),
                  direction: tDiff > 0.05 ? "up" : tDiff < -0.05 ? "down" : "flat",
                  sentiment: Math.abs(tDiff) > 2 ? "bad" : "neutral",
                }
              : undefined
          }
          sub={
            !t
              ? "No readings yet"
              : tStale
                ? `Last known · ${ago(t.created_at)}`
                : target != null
                  ? `vs ${formatTemp(target)} target`
                  : "Latest reading"
          }
        />
        <Metric
          className="max-md:hidden"
          label="Humidity"
          loading={loading}
          status={
            h?.humidity != null
              ? hStale
                ? "offline"
                : h.humidity < RH_TARGET[0] || h.humidity > RH_TARGET[1]
                  ? "warn"
                  : "ok"
              : undefined
          }
          value={h?.humidity != null ? formatNumber(h.humidity) : null}
          unit="% RH"
          sub={
            !h
              ? "No readings yet"
              : hStale
                ? `Last known · ${ago(h.created_at)}`
                : `Target ${RH_TARGET[0]}–${RH_TARGET[1]}${NBSP}%`
          }
        />
        <Metric
          label="Open alerts"
          loading={loading}
          status={stats ? (openAlerts === 0 ? "ok" : openCritical ? "crit" : "warn") : undefined}
          value={stats ? formatNumber(openAlerts) : null}
          sub={
            openAlerts === 0
              ? "All clear"
              : latestOpen
                ? `Latest ${ago(latestOpen.created_at)}`
                : "Needs review"
          }
        />
        <Metric
          className="max-md:hidden"
          label="Gas index"
          loading={loading}
          status={gas != null ? (lStale ? "offline" : gas > GAS_HIGH ? "warn" : "ok") : undefined}
          value={gas != null ? formatNumber(gas) : null}
          sub={
            !latest
              ? "No readings yet"
              : lStale
                ? `Last known · ${ago(latest.created_at)}`
                : gas != null && gas > GAS_HIGH
                  ? `Above ${GAS_HIGH}, ventilate`
                  : "MQ-135 · normal"
          }
        />
        <Metric
          className="max-md:hidden"
          label="Fan"
          loading={loading}
          status={latest?.fan_on != null ? (lStale ? "offline" : "ok") : undefined}
          value={latest?.fan_on != null ? formatFan(latest.fan_on) : null}
          sub={
            !latest
              ? "No readings yet"
              : lStale
                ? `Last known · ${ago(latest.created_at)}`
                : latest.fan_on
                  ? "Relay closed, fan running"
                  : "Relay open, fan stopped"
          }
        />
      </MetricGrid>
    </Section>
  );
}

/* -------------------------------------------------------------------------- *
 * 3. Climate trends
 * -------------------------------------------------------------------------- */

function Trends({
  loading,
  history,
  target,
  live,
  now,
}: {
  loading: boolean;
  history: { temperature: number | null; humidity: number | null; created_at: string }[];
  target: number | null;
  live: boolean;
  now: number;
}) {
  const points = history.map((r) => ({
    t: new Date(r.created_at).getTime(),
    // Display unit (°C or °F); the band and target below are converted the same way.
    temperature: toTemp(num(r.temperature)),
    humidity: num(r.humidity),
  }));
  const tTarget = toTemp(target);
  const tBand = toTempDelta(TEMP_BAND)!;
  const hasT = points.some((p) => p.temperature != null);
  // Keep the target band in view so the gap to target is visible.
  const span = (vals: (number | null)[], lo: number, hi: number, pad: number): [number, number] => {
    const v = vals.filter((x): x is number => x != null);
    return [Math.floor(Math.min(lo, ...v) - pad), Math.ceil(Math.max(hi, ...v) + pad)];
  };
  const tVals = points.map((p) => p.temperature);
  const tDomain =
    tTarget != null
      ? span(tVals, tTarget - tBand, tTarget + tBand, 1)
      : span(tVals, Infinity, -Infinity, 1);
  const hDomain = span(
    points.map((p) => p.humidity),
    RH_TARGET[0],
    RH_TARGET[1],
    3,
  );
  const hasH = points.some((p) => p.humidity != null);
  const first = points[0]?.t;
  const last = points[points.length - 1]?.t;
  const spanDays = first && last ? (last - first) / 86_400_000 : 0;
  const tick = (v: number) =>
    spanDays > 1
      ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
      : formatTime(v);

  const description = loading ? (
    <Skeleton className="mt-1 h-3 w-56" />
  ) : first && last ? (
    <>
      Last {points.length} readings · {formatDateTime(first)} – {formatTime(last)}
    </>
  ) : undefined;

  const action =
    !loading && last && !live ? (
      <StatusPill status="offline" size="sm" title={`Last reading ${formatDateTime(last)}`}>
        Not live · {formatRelative(last, now)}
      </StatusPill>
    ) : undefined;

  const emptyHint = "Charts fill in as soon as the Pi starts reporting, every 30 s.";

  return (
    <Section title="Climate trend" description={description} action={action}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="pg-panel min-w-0 p-4 md:p-5">
          <h3 className="pg-t-h3 mb-3">Temperature</h3>
          <ChartFrame
            height={220}
            loading={loading}
            empty={!hasT}
            emptyTitle="No temperature readings yet"
            emptyHint={emptyHint}
            legend={
              <ChartLegend
                items={[
                  { label: "Temperature", color: chartColors.series[0] },
                  ...(target != null
                    ? [
                        {
                          label: `Target ${formatNumber(tTarget! - tBand)}–${formatNumber(tTarget! + tBand)}${NBSP}${tempUnit()}`,
                          color: chartColors.target,
                          kind: "band" as const,
                        },
                      ]
                    : []),
                ]}
              />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis
                  {...xAxisProps}
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={tick}
                />
                <YAxis {...yAxisProps} domain={tDomain} allowDecimals={false} />
                {tTarget != null && (
                  <ReferenceArea {...targetBandProps} y1={tTarget - tBand} y2={tTarget + tBand} />
                )}
                <Tooltip
                  content={
                    <ChartTooltip
                      units={{ temperature: tempUnit() }}
                      labelFormatter={(l) => formatDateTime(l as number)}
                    />
                  }
                  cursor={tooltipCursor}
                />
                <Line
                  {...lineProps}
                  dataKey="temperature"
                  name="Temperature"
                  stroke={chartColors.series[0]}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <div className="pg-panel min-w-0 p-4 md:p-5">
          <h3 className="pg-t-h3 mb-3">Humidity</h3>
          <ChartFrame
            height={220}
            loading={loading}
            empty={!hasH}
            emptyTitle="No humidity readings yet"
            emptyHint={emptyHint}
            legend={
              <ChartLegend
                items={[
                  { label: "Relative humidity", color: chartColors.series[2] },
                  {
                    label: `Target ${RH_TARGET[0]}–${RH_TARGET[1]}${NBSP}%`,
                    color: chartColors.target,
                    kind: "band",
                  },
                ]}
              />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis
                  {...xAxisProps}
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={tick}
                />
                <YAxis {...yAxisProps} domain={hDomain} allowDecimals={false} />
                <ReferenceArea {...targetBandProps} y1={RH_TARGET[0]} y2={RH_TARGET[1]} />
                <Tooltip
                  content={
                    <ChartTooltip
                      units={{ humidity: `${NBSP}%` }}
                      labelFormatter={(l) => formatDateTime(l as number)}
                    />
                  }
                  cursor={tooltipCursor}
                />
                <Line
                  {...lineProps}
                  dataKey="humidity"
                  name="Humidity"
                  stroke={chartColors.series[2]}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- *
 * 4a. Houses
 * -------------------------------------------------------------------------- */

function ageDay(h: House) {
  if (!h.batch_started_at) return null;
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(h.batch_started_at).getTime()) / 86_400_000),
  );
}

function HousesSummary({
  query,
  className,
}: {
  query: Q<Awaited<ReturnType<typeof listHouses>>> & { error: unknown; refetch: () => unknown };
  className?: string;
}) {
  const { canManage } = useAuth();
  const action = (
    <Link to="/app/houses" className={buttonClass({ variant: "ghost", size: "sm" })}>
      All houses
      <ArrowRight aria-hidden strokeWidth={1.75} />
    </Link>
  );

  let body: ReactNode;
  if (query.isPending) body = <SkeletonRows rows={3} cols={5} />;
  else if (query.isError || !query.data)
    body = (
      <ErrorState
        title="Couldn’t load houses"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  else if (query.data.houses.length === 0)
    body = (
      <EmptyState
        title="No houses yet"
        description="Each house gets a row here with its birds, flock age, latest climate and condition."
        action={
          canManage ? (
            <Link to="/app/houses" className={buttonClass({ variant: "primary" })}>
              Add house
            </Link>
          ) : undefined
        }
        note={canManage ? undefined : "Ask a farm manager to add houses."}
      />
    );
  else {
    const latest = query.data.latest;
    body = (
      <DataTable
        caption="Houses"
        rows={query.data.houses}
        rowKey={(h) => h.id}
        columns={[
          {
            key: "name",
            header: "House",
            mobile: "title",
            cell: (h) => <span className="font-medium text-ink">{h.name}</span>,
          },
          {
            key: "status",
            header: "Condition",
            mobile: "status",
            cell: (h) => {
              const r = latest[h.id];
              return r ? (
                <AiStatusBadge status={r.ai_status} at={r.created_at} />
              ) : (
                <StatusPill status="offline" size="sm">
                  No sensor
                </StatusPill>
              );
            },
          },
          {
            key: "birds",
            header: "Birds",
            align: "right",
            cell: (h) => (
              <span className="pg-mono">
                {formatNumber(h.bird_count, { maximumFractionDigits: 0 })}
              </span>
            ),
          },
          {
            key: "age",
            header: "Age",
            align: "right",
            cell: (h) => {
              const a = ageDay(h);
              return a == null ? (
                <span className="text-ink-3">—</span>
              ) : (
                <span className="pg-mono">Day {a}</span>
              );
            },
          },
          {
            key: "temp",
            header: "Temp",
            align: "right",
            cell: (h) => {
              const r = latest[h.id];
              return r ? <TempVsTarget r={r} /> : <span className="text-ink-3">—</span>;
            },
          },
          {
            key: "rh",
            header: "RH",
            align: "right",
            cell: (h) => {
              const r = latest[h.id];
              return <Num v={r?.humidity} unit="%" muted={!r || isStale(r)} />;
            },
          },
          {
            key: "seen",
            header: "Last reading",
            align: "right",
            mobile: "hide",
            cell: (h) => {
              const r = latest[h.id];
              return r ? (
                <RelativeTime iso={r.created_at} className="text-ink-2" />
              ) : (
                <span className="text-ink-3">Never</span>
              );
            },
          },
        ]}
      />
    );
  }

  return (
    <Section
      title="Houses"
      description={
        query.data
          ? `${query.data.houses.length} ${query.data.houses.length === 1 ? "house" : "houses"}`
          : undefined
      }
      action={action}
      className={className}
    >
      {body}
    </Section>
  );
}

/* -------------------------------------------------------------------------- *
 * 4b. Recent alerts
 * -------------------------------------------------------------------------- */

/** "main: Warning: Heat stress. Fan switched on." -> where "main", text "Heat stress. …" */
function splitAlert(msg: string) {
  const m = /^\s*([^:]{1,40}):\s*(?:healthy|warning|critical|info)\s*:\s*(.+)$/is.exec(msg);
  return m ? { where: m[1].trim(), text: m[2].trim() } : { where: null, text: msg };
}

const SEVERITY: Record<Alert["severity"], { status: "crit" | "warn" | "info"; label: string }> = {
  critical: { status: "crit", label: "Critical" },
  warning: { status: "warn", label: "Warning" },
  info: { status: "info", label: "Info" },
};

function RecentAlerts({
  loading,
  alerts,
  openCount,
  className,
}: {
  loading: boolean;
  alerts: Alert[];
  openCount: number;
  className?: string;
}) {
  const action = (
    <Link to="/app/alerts" className={buttonClass({ variant: "ghost", size: "sm" })}>
      All alerts
      <ArrowRight aria-hidden strokeWidth={1.75} />
    </Link>
  );

  return (
    <Section
      title="Recent alerts"
      description={loading ? undefined : `${openCount} open`}
      action={action}
      className={className}
    >
      {loading ? (
        <div className="pg-panel divide-y divide-hairline" role="status" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-4 py-3">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState
          title="No alerts"
          description="Warnings from the edge AI and sensors are listed here as they are raised."
        />
      ) : (
        <ul className="pg-panel divide-y divide-hairline overflow-hidden">
          {alerts.map((a) => {
            const sev = SEVERITY[a.severity] ?? SEVERITY.info;
            const resolved = !!a.resolved;
            const { where, text } = splitAlert(a.message);
            return (
              <li
                key={a.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3"
              >
                <SeverityMark
                  tone={resolved ? "off" : sev.status === "info" ? "off" : sev.status}
                  className="mt-1"
                />
                <div className="min-w-0">
                  <p
                    className={cn(
                      "line-clamp-2 text-[14px] leading-5",
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
                      {resolved ? "Resolved" : sev.label}
                    </span>{" "}
                    {text}
                  </p>
                  {where && (
                    <p className="pg-mono mt-0.5 truncate text-[12px] leading-4 text-ink-3">
                      {where}
                    </p>
                  )}
                </div>
                <time
                  dateTime={new Date(a.created_at).toISOString()}
                  title={formatDateTime(a.created_at)}
                  className="pg-mono pt-0.5 text-right text-[12px] leading-4 whitespace-nowrap text-ink-3"
                >
                  {formatRelative(a.created_at)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
