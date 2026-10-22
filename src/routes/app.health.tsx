import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getAiMonitor } from "@/lib/api/farm.functions";
import { AiStatusBadge, AiStatusPanel, STATUS_META, isStale } from "@/components/ai-status";
import {
  Button,
  Card,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  EmptyState,
  ErrorState,
  Meter,
  PageHeader,
  RelativeTime,
  SegmentedControl,
  Skeleton,
  SkeletonText,
  buttonClass,
  chartColors,
  fitDomain,
  formatDateTime,
  formatNumber,
  formatTemp,
  formatUnit,
  toTempDelta,
  tempUnit,
  toTemp,
  useDisplayPrefs,
  gridProps,
  lineProps,
  timeTick,
  tooltipCursor,
  xAxisProps,
  yAxisProps,
} from "@/components/ui-kit";
import type { AiSnapshot, AiStatus, Reading } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/* Range + device live in the URL so a view can be shared or bookmarked. */
const RANGES = [
  { value: "1h", label: "1 h", hours: 1, long: "hour" },
  { value: "6h", label: "6 h", hours: 6, long: "6 hours" },
  { value: "24h", label: "24 h", hours: 24, long: "24 hours" },
  { value: "7d", label: "7 d", hours: 168, long: "7 days" },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];

type HealthSearch = { range?: RangeKey; device?: string };

export const Route = createFileRoute("/app/health")({
  validateSearch: (s: Record<string, unknown>): HealthSearch => ({
    range: RANGES.some((r) => r.value === s.range) ? (s.range as RangeKey) : undefined,
    device:
      typeof s.device === "string" && /^[0-9a-f-]{36}$/i.test(s.device) ? s.device : undefined,
  }),
  component: Health,
});

const STATES = ["healthy", "warning", "critical"] as const;
/** Gas index level the edge model treats as "High" (see ai-status gasWord). */
const GAS_HIGH = 22;
/** ± band around the age-based target the model aims for. */
const TARGET_BAND = 1;
/** "±1 °C" / "±1.8 °F". */
const bandText = () => `±${formatUnit(toTempDelta(TARGET_BAND), tempUnit())}`;
const NBSP = String.fromCharCode(160);

function Health() {
  // Re-render when the clock or temperature unit preference changes.
  useDisplayPrefs();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const rangeKey: RangeKey = search.range ?? "6h";
  const range = RANGES.find((r) => r.value === rangeKey)!;

  const setSearch = (patch: HealthSearch) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const q = useQuery({
    queryKey: ["ai-monitor", search.device, range.hours],
    queryFn: () => getAiMonitor({ data: { deviceId: search.device, hours: range.hours } }),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });

  const latest = q.data?.latest ?? [];
  const current = latest.find((l) => l.device_id === q.data?.selected);
  const history = q.data?.history ?? [];
  const switching = q.isFetching && q.isPlaceholderData;

  const rangeControl = (
    <SegmentedControl
      ariaLabel="Time range"
      value={rangeKey}
      onChange={(v) => setSearch({ range: v === "6h" ? undefined : v })}
      options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
    />
  );

  const header = (
    <PageHeader className="mb-2 md:mb-2" title="Flock health">
      {latest.length > 0 && rangeControl}
    </PageHeader>
  );

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        {header}
        <div className="pg-panel p-4 md:p-5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-3 h-6 w-48" />
          <SkeletonText lines={2} className="mt-6" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Temperature vs target" className="lg:col-span-2">
            <ChartFrame height={260} loading>
              {null}
            </ChartFrame>
          </Card>
          <Card title="Time in each state">
            <SkeletonText lines={4} />
          </Card>
        </div>
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ErrorState
          title="Couldn’t load flock health"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  }

  if (latest.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState
          title="Waiting for the Raspberry Pi"
          description={
            <>
              Coop condition, temperature against the age target and gas levels appear here once the
              edge model sends its first reading. Register the Pi under Devices, then run{" "}
              <code className="pg-mono text-[13px]">python agent.py</code> from{" "}
              <code className="pg-mono text-[13px]">edge/</code> (add{" "}
              <code className="pg-mono text-[13px]">--simulate</code> to try it without sensors).
            </>
          }
          action={
            <Link to="/app/devices" className={buttonClass({ variant: "primary" })}>
              Go to devices
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}

      {latest.length > 1 && (
        <DevicePicker
          devices={latest}
          selected={q.data?.selected ?? null}
          onSelect={(id) => setSearch({ device: id })}
        />
      )}

      {current && (
        <>
          <p className="sr-only" aria-live="polite">
            {current.house_name ?? current.device_code}:{" "}
            {isStale(current) ? "no live data, last known" : ""}{" "}
            {STATUS_META[current.ai_status ?? "healthy"].label}
          </p>
          <AiStatusPanel r={current} />
        </>
      )}

      {history.length === 0 ? (
        <NoHistory
          range={range}
          current={current}
          onRange={(v) => setSearch({ range: v === "6h" ? undefined : v })}
        />
      ) : (
        <div
          className={cn("grid gap-4 lg:grid-cols-3", switching && "opacity-60 transition-opacity")}
        >
          <Card
            title="Temperature vs target"
            description={`Last ${range.long} · target band ${bandText()} for flock age`}
            className="lg:col-span-2"
          >
            <TempChart history={history} range={range.long} current={current} />
          </Card>
          <Card title="Time in each state" description={`Last ${range.long}`}>
            <TimeInState history={history} hours={range.hours} />
          </Card>

          <Card
            title="Gas and humidity"
            description={`Last ${range.long} · MQ-135 gas index and relative humidity`}
            className="lg:col-span-2"
          >
            <GasChart history={history} range={range.long} current={current} />
          </Card>
          <Card title="Status changes" description={`Last ${range.long}`} padding="none">
            <StatusChanges history={history} />
          </Card>
        </div>
      )}
    </div>
  );
}

/** One designed empty state instead of four empty chart frames. */
function NoHistory({
  range,
  current,
  onRange,
}: {
  range: (typeof RANGES)[number];
  current: Reading | undefined;
  onRange: (v: RangeKey) => void;
}) {
  const ageH = current ? (Date.now() - new Date(current.created_at).getTime()) / 3_600_000 : null;
  const fits = ageH != null ? RANGES.find((r) => r.hours >= ageH) : undefined;
  return (
    <EmptyState
      title={`No readings in the last ${range.long}`}
      description={
        current
          ? fits
            ? `The Pi last reported ${formatDateTime(current.created_at)}. Widen the range to chart temperature, gas and humidity up to that point.`
            : `The Pi last reported ${formatDateTime(current.created_at)}, more than 7 days ago, so no range covers it. Check that it’s powered and online.`
          : "Charts for temperature against target, gas and humidity appear once the Pi reports."
      }
      action={
        fits && fits.value !== range.value ? (
          <Button variant="primary" onClick={() => onRange(fits.value)}>
            Show last {fits.long}
          </Button>
        ) : (
          <Link to="/app/devices" className={buttonClass({ variant: "primary" })}>
            Check devices
          </Link>
        )
      }
      secondary={
        fits && fits.value !== range.value ? (
          <Link to="/app/devices" className={buttonClass({ variant: "secondary" })}>
            Check devices
          </Link>
        ) : undefined
      }
    />
  );
}

/* ------------------------------------------------------------------------ */

function DevicePicker({
  devices,
  selected,
  onSelect,
}: {
  devices: AiSnapshot[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Houses with edge AI">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
        {devices.map((l) => {
          const on = l.device_id === selected;
          const stale = isStale(l);
          return (
            <li key={l.device_id} className="min-w-0">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(l.device_id)}
                className={cn(
                  "relative flex min-h-11 w-full flex-col gap-1 overflow-hidden rounded-lg border bg-surface px-4 py-3 text-left transition-colors",
                  on ? "border-brand/40 bg-brand-tint/40" : "border-hairline hover:bg-hover",
                )}
              >
                {on && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-brand" />}
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[14px] leading-5 font-medium text-ink">
                    {l.house_name ?? l.device_code}
                  </span>
                  <AiStatusBadge status={l.ai_status} at={l.created_at} />
                </span>
                <span
                  className={cn(
                    "pg-mono text-[12px] leading-4",
                    stale ? "text-ink-3" : "text-ink-2",
                  )}
                >
                  {formatTemp(l.temperature)} · {formatNumber(l.humidity)}% · gas{" "}
                  {formatNumber(l.gas_index)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------------ */

/** Shorter charts on phone (design system: 200–240px max). */
function useChartHeight(desktop: number, phone: number) {
  const [h, setH] = useState(desktop);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 767px)");
    const sync = () => setH(m.matches ? phone : desktop);
    sync();
    m.addEventListener("change", sync);
    return () => m.removeEventListener("change", sync);
  }, [desktop, phone]);
  return h;
}

function emptyHint(current: Reading | undefined) {
  return current
    ? `The Pi last reported ${formatDateTime(current.created_at)}. Pick a longer range to see older readings.`
    : "Readings appear as soon as the Pi reports.";
}

function TempChart({
  history,
  range,
  current,
}: {
  history: Reading[];
  range: string;
  current: Reading | undefined;
}) {
  const data = history.map((r) => ({
    t: r.created_at,
    // Display unit (°C or °F): convert the band edges as absolute temperatures.
    temperature: toTemp(r.temperature),
    target: toTemp(r.target_temp),
    band:
      r.target_temp != null
        ? [toTemp(r.target_temp - TARGET_BAND), toTemp(r.target_temp + TARGET_BAND)]
        : null,
  }));
  const hasTarget = data.some((d) => d.target != null);
  const height = useChartHeight(260, 200);
  return (
    <>
      <ChartFrame
        height={height}
        empty={!data.length}
        emptyTitle={`No readings in the last ${range}`}
        emptyHint={emptyHint(current)}
        legend={
          <ChartLegend
            items={[
              { label: "Temperature", color: chartColors.series[0] },
              ...(hasTarget
                ? [
                    { label: "Age target", color: chartColors.axis },
                    {
                      label: `Target ${bandText()}`,
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
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis {...xAxisProps} dataKey="t" tickFormatter={timeTick} />
            <YAxis {...yAxisProps} domain={fitDomain(1)} unit="°" />
            <Tooltip
              content={
                <ChartTooltip
                  units={{ temperature: tempUnit(), target: tempUnit() }}
                  labelFormatter={(l) => formatDateTime(l as string)}
                />
              }
              cursor={tooltipCursor}
            />
            <Area
              dataKey="band"
              fill={chartColors.target}
              fillOpacity={0.08}
              stroke="none"
              isAnimationActive={false}
              tooltipType="none"
              activeDot={false}
            />
            <Line
              {...lineProps}
              dataKey="target"
              name="Target"
              stroke={chartColors.axis}
              strokeWidth={1}
              strokeDasharray="4 4"
              activeDot={false}
            />
            <Line
              {...lineProps}
              dataKey="temperature"
              name="Temperature"
              stroke={chartColors.series[0]}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
      {data.length > 0 && <StatusStrip history={history} />}
    </>
  );
}

/** Thin per-reading status strip under the temperature chart. Text summary lives in "Time in each state". */
function StatusStrip({ history }: { history: Reading[] }) {
  return (
    <div className="mt-3 pl-10">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
        {history.map((r) => (
          <span
            key={r.id}
            className="h-full flex-1"
            style={{ background: STATUS_META[(r.ai_status ?? "healthy") as AiStatus].color }}
          />
        ))}
      </div>
      <p className="pg-t-caption mt-1.5">AI status per reading</p>
    </div>
  );
}

function GasChart({
  history,
  range,
  current,
}: {
  history: Reading[];
  range: string;
  current: Reading | undefined;
}) {
  const data = history.map((r) => ({ t: r.created_at, gas: r.gas_index, humidity: r.humidity }));
  const gasMax = Math.max(0, ...data.map((d) => d.gas ?? 0));
  const height = useChartHeight(220, 180);
  return (
    <ChartFrame
      height={height}
      empty={!data.length}
      emptyTitle={`No readings in the last ${range}`}
      emptyHint={emptyHint(current)}
      legend={
        <ChartLegend
          items={[
            { label: "Gas index (left)", color: chartColors.series[3] },
            { label: "Humidity % (right)", color: chartColors.series[2] },
            ...(gasMax >= GAS_HIGH * 0.6
              ? [{ label: `Gas high at ${GAS_HIGH}`, color: chartColors.crit }]
              : []),
          ]}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis {...xAxisProps} dataKey="t" tickFormatter={timeTick} />
          <YAxis {...yAxisProps} yAxisId="g" domain={fitDomain(2)} />
          <YAxis {...yAxisProps} yAxisId="h" orientation="right" domain={fitDomain(3)} unit="%" />
          <Tooltip
            content={
              <ChartTooltip
                units={{ humidity: "%" }}
                labelFormatter={(l) => formatDateTime(l as string)}
              />
            }
            cursor={tooltipCursor}
          />
          {gasMax >= GAS_HIGH * 0.6 && (
            <ReferenceLine
              yAxisId="g"
              y={GAS_HIGH}
              stroke={chartColors.crit}
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              ifOverflow="extendDomain"
            />
          )}
          <Line
            {...lineProps}
            yAxisId="g"
            dataKey="gas"
            name="Gas index"
            stroke={chartColors.series[3]}
          />
          <Line
            {...lineProps}
            yAxisId="h"
            dataKey="humidity"
            name="Humidity"
            stroke={chartColors.series[2]}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------------ */

function formatHours(h: number) {
  if (h < 1) return `${Math.round(h * 60)}${NBSP}min`;
  if (h < 48) return `${formatNumber(h)}${NBSP}h`;
  return `${formatNumber(h / 24)}${NBSP}d`;
}

function TimeInState({ history, hours }: { history: Reading[]; hours: number }) {
  if (!history.length) {
    return (
      <p className="text-[13px] leading-[18px] text-ink-3">
        No readings in this range, so there is nothing to split yet.
      </p>
    );
  }
  // Readings are roughly evenly spaced, so the share of readings ≈ share of time.
  const span = Math.min(
    hours,
    (new Date(history[history.length - 1].created_at).getTime() -
      new Date(history[0].created_at).getTime()) /
      3_600_000,
  );
  return (
    <div>
      <ul className="flex flex-col gap-4">
        {STATES.map((s) => {
          const share = history.filter((r) => r.ai_status === s).length / history.length;
          return (
            <li key={s}>
              <Meter
                value={share}
                status={STATUS_META[s].status}
                label={STATUS_META[s].label}
                valueLabel={
                  <>
                    {Math.round(share * 100)}%
                    {span > 0 && (
                      <span className="ml-1.5 text-ink-3">{formatHours(share * span)}</span>
                    )}
                  </>
                }
              />
            </li>
          );
        })}
      </ul>
      <p className="pg-t-caption mt-4 border-t border-hairline pt-3">
        Based on <span className="pg-mono">{history.length}</span>{" "}
        {history.length === 1 ? "reading" : "readings"}
        {span > 0 && <> over {formatHours(span)}</>}
      </p>
    </div>
  );
}

function StatusChanges({ history }: { history: Reading[] }) {
  const changes = history
    .map((r, i) => ({ r, prev: i > 0 ? history[i - 1] : undefined }))
    .filter(({ r, prev }) => prev && r.ai_status !== prev.ai_status)
    .slice(-8)
    .reverse();

  if (!history.length) {
    return (
      <p className="px-4 pt-3 pb-4 text-[13px] leading-[18px] text-ink-3 md:px-5">
        No readings in this range.
      </p>
    );
  }
  if (!changes.length) {
    const s = (history[history.length - 1].ai_status ?? "healthy") as AiStatus;
    return (
      <p className="px-4 pt-3 pb-4 text-[13px] leading-[18px] text-ink-2 md:px-5">
        No changes. The flock stayed{" "}
        <span className="font-medium">{STATUS_META[s].label.toLowerCase()}</span> for the whole
        range.
      </p>
    );
  }
  return (
    <ol className="mt-1">
      {changes.map(({ r, prev }) => {
        const s = (r.ai_status ?? "healthy") as AiStatus;
        const causes = r.ai_causes?.map((c) => c.label).join(", ");
        return (
          <li
            key={r.id}
            className="flex items-start gap-3 border-t border-hairline px-4 py-3 first:border-t-0 md:px-5"
          >
            <span
              aria-hidden
              className="mt-1.5 size-2 shrink-0 rounded-full"
              style={{ background: STATUS_META[s].color }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] leading-5 font-medium text-ink">
                  {prev?.ai_status ? `${STATUS_META[prev.ai_status].label} → ` : ""}
                  {STATUS_META[s].label}
                </span>
                <RelativeTime iso={r.created_at} className="pg-t-caption shrink-0" />
              </div>
              <p className="truncate text-[13px] leading-[18px] text-ink-3">
                {s === "healthy" ? "Back to normal" : causes || "No cause reported"}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
