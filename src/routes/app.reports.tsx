import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import {
  getAiMonitor,
  listAlerts,
  listCameras,
  listDevices,
  listHatcheries,
  listHouses,
} from "@/lib/api/farm.functions";
import {
  Button,
  DescList,
  ErrorState,
  Metric,
  MetricGrid,
  PageHeader,
  RelativeTime,
  Section,
  Skeleton,
  SkeletonMetrics,
  formatNumber,
} from "@/components/ui-kit";

export const Route = createFileRoute("/app/reports")({ component: Reports });

/* ---------- CSV ---------------------------------------------------------- */

type Cell = string | number | boolean | null | undefined;

function toCsv(header: string[], rows: Cell[][]) {
  const esc = (v: Cell) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

function downloadCsv(name: string, csv: string) {
  // BOM so Excel opens UTF-8 (°C, ·) correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `poultrygrid-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const DAY = 86_400_000;
const within = (iso: string, days: number) => Date.now() - new Date(iso).getTime() < days * DAY;

/* ---------- Page --------------------------------------------------------- */

function Reports() {
  const qc = useQueryClient();
  const houses = useQuery({ queryKey: ["houses"], queryFn: () => listHouses() });
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => listDevices() });
  const alerts = useQuery({ queryKey: ["reports", "alerts"], queryFn: () => listAlerts() });
  const hatch = useQuery({ queryKey: ["reports", "hatcheries"], queryFn: () => listHatcheries() });
  const cams = useQuery({ queryKey: ["cameras"], queryFn: () => listCameras() });

  const summaryQueries = [houses, devices, alerts];
  const summaryPending = summaryQueries.some((q) => q.isPending);
  const summaryError = summaryQueries.find((q) => q.isError);

  const hs = houses.data?.houses ?? [];
  const birds = hs.reduce((n, h) => n + (h.bird_count ?? 0), 0);
  const capacity = hs.reduce((n, h) => n + (h.capacity ?? 0), 0);
  const open = alerts.data?.filter((a) => !a.resolved) ?? [];
  const openCrit = open.filter((a) => a.severity === "critical").length;
  const online = devices.data?.filter((d) => d.online).length ?? 0;
  const lastReading = Object.values(houses.data?.latest ?? {})
    .map((r) => r.created_at)
    .concat((devices.data ?? []).map((d) => d.last_seen).filter((s): s is string => !!s))
    .sort()
    .at(-1);

  const a30 = alerts.data?.filter((a) => within(a.created_at, 30));

  const exports: ExportDef[] = [
    {
      id: "houses",
      name: "Houses and latest conditions",
      detail: "Birds, capacity, batch and each house’s most recent reading.",
      count: houses.data ? hs.length : undefined,
      pending: houses.isPending,
      run: async () => {
        const d = await qc.fetchQuery({ queryKey: ["houses"], queryFn: () => listHouses() });
        return toCsv(
          [
            "house",
            "farm",
            "birds",
            "capacity",
            "batch",
            "batch_started",
            "temperature_c",
            "humidity_pct",
            "gas_index",
            "light_level",
            "fan",
            "ai_status",
            "reading_at",
          ],
          d.houses.map((h) => {
            const r = d.latest[h.id];
            return [
              h.name,
              h.farm_name,
              h.bird_count,
              h.capacity,
              h.batch_name,
              h.batch_started_at,
              r?.temperature,
              r?.humidity,
              r?.gas_index,
              r?.light,
              r?.fan_level,
              r?.ai_status,
              r?.created_at,
            ];
          }),
        );
      },
    },
    {
      id: "alerts",
      name: "Alerts",
      detail: "Latest 100 alerts with severity, source and resolution.",
      count: alerts.data?.length,
      pending: alerts.isPending,
      run: async () => {
        const d = await qc.fetchQuery({
          queryKey: ["reports", "alerts"],
          queryFn: () => listAlerts(),
        });
        return toCsv(
          ["created_at", "severity", "type", "message", "resolved", "house_id", "device_id"],
          d.map((a) => [
            a.created_at,
            a.severity,
            a.type,
            a.message,
            !!a.resolved,
            a.house_id,
            a.device_id,
          ]),
        );
      },
    },
    {
      id: "readings",
      name: "Edge AI readings",
      detail:
        "Most recently reporting Pi, last 7 days (up to 720 points): DHT22, MQ-135, light, fan and AI output.",
      run: async () => {
        const d = await qc.fetchQuery({
          queryKey: ["reports", "readings-7d"],
          queryFn: () => getAiMonitor({ data: { hours: 168 } }),
        });
        const code = d.latest.find((l) => l.device_id === d.selected)?.device_code ?? "";
        return toCsv(
          [
            "created_at",
            "device",
            "temperature_c",
            "humidity_pct",
            "gas_index",
            "light_level",
            "fan",
            "bird_age_days",
            "growth_phase",
            "target_temp_c",
            "ai_status",
            "ai_confidence",
            "ai_causes",
          ],
          d.history.map((r) => [
            r.created_at,
            code,
            r.temperature,
            r.humidity,
            r.gas_index,
            r.light,
            r.fan_level,
            r.bird_age_days,
            r.growth_phase,
            r.target_temp,
            r.ai_status,
            r.ai_confidence,
            (r.ai_causes ?? []).map((c) => c.label).join("; "),
          ]),
        );
      },
    },
    {
      id: "hatchery",
      name: "Hatchery batches",
      detail: "Eggs set, chicks hatched, dates and the incubator settings entered.",
      count: hatch.data?.length,
      pending: hatch.isPending,
      run: async () => {
        const d = await qc.fetchQuery({
          queryKey: ["reports", "hatcheries"],
          queryFn: () => listHatcheries(),
        });
        return toCsv(
          [
            "batch",
            "farm",
            "eggs",
            "hatched",
            "started_at",
            "expected_hatch_at",
            "incubator_set_temp_c",
            "incubator_set_rh_pct",
          ],
          d.map((h) => [
            h.name,
            h.farm_name,
            h.egg_count,
            h.hatched_count,
            h.started_at,
            h.expected_hatch_at,
            h.temperature,
            h.humidity,
          ]),
        );
      },
    },
    {
      id: "devices",
      name: "Device inventory",
      detail: "Raspberry Pi IDs, house, fan mode and last check-in. API keys are left out.",
      count: devices.data?.length,
      pending: devices.isPending,
      run: async () => {
        const d = await qc.fetchQuery({ queryKey: ["devices"], queryFn: () => listDevices() });
        return toCsv(
          [
            "device_id",
            "type",
            "house",
            "location",
            "fan_override",
            "online",
            "last_seen",
            "registered_at",
          ],
          d.map((x) => [
            x.device_id,
            x.type,
            x.house_name,
            x.location,
            x.fan_override,
            !!x.online,
            x.last_seen,
            x.created_at,
          ]),
        );
      },
    },
    {
      id: "cameras",
      name: "Cameras",
      detail: "Name, house and stream URL of each ESP32-CAM.",
      count: cams.data?.length,
      pending: cams.isPending,
      run: async () => {
        const d = await qc.fetchQuery({ queryKey: ["cameras"], queryFn: () => listCameras() });
        return toCsv(
          ["name", "house", "stream_url", "added_at"],
          d.map((c) => [c.name, c.house_name, c.stream_url, c.created_at]),
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Reports"
        meta={lastReading ? <RelativeTime iso={lastReading} prefix="Latest data" /> : undefined}
        className="mb-0 md:mb-0"
      />

      {summaryPending ? (
        <SkeletonMetrics count={4} cols={4} />
      ) : summaryError ? (
        <ErrorState
          title="Couldn’t load the farm summary"
          error={summaryError.error}
          onRetry={() => summaryQueries.forEach((q) => void q.refetch())}
        />
      ) : (
        <MetricGrid cols={4}>
          <Metric
            label="Birds housed"
            value={hs.length ? formatNumber(birds) : null}
            sub={
              hs.length
                ? capacity
                  ? `${Math.round((birds / capacity) * 100)}% of ${formatNumber(capacity)} capacity`
                  : `${hs.length} houses`
                : "No houses yet"
            }
          />
          <Metric
            label="Open alerts"
            value={open.length}
            status={openCrit ? "crit" : open.length ? "warn" : "ok"}
            sub={openCrit ? `${openCrit} critical` : open.length ? "None critical" : "All resolved"}
          />
          <Metric
            label="Devices online"
            value={devices.data?.length ? online : null}
            unit={devices.data?.length ? ` / ${devices.data.length}` : undefined}
            sub={devices.data?.length ? undefined : "No devices registered"}
          />
          <Metric
            label="Houses reporting"
            value={hs.length ? Object.keys(houses.data?.latest ?? {}).length : null}
            unit={hs.length ? ` / ${hs.length}` : undefined}
            sub={hs.length ? "With at least one reading" : "No houses yet"}
          />
        </MetricGrid>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
        <Section
          title="Exports"
          description="CSV files built in your browser from live data. They open in Excel and Google Sheets."
        >
          <ul className="pg-panel divide-y divide-hairline">
            {exports.map((e) => (
              <ExportRow key={e.id} def={e} />
            ))}
          </ul>
          <p className="pg-t-caption mt-3">PDF and scheduled email reports aren’t available yet.</p>
        </Section>

        <Section title="Last 30 days">
          <div className="pg-panel px-4 py-1 md:px-5">
            <DescList
              items={[
                {
                  label: "Alerts raised",
                  value: a30 ? a30.length : <Skeleton className="h-3.5 w-8" />,
                },
                {
                  label: "Critical alerts",
                  value: a30 ? (
                    a30.filter((a) => a.severity === "critical").length
                  ) : (
                    <Skeleton className="h-3.5 w-8" />
                  ),
                },
                {
                  label: "Alerts resolved",
                  value: a30 ? (
                    a30.length ? (
                      `${a30.filter((a) => a.resolved).length} of ${a30.length}`
                    ) : (
                      "—"
                    )
                  ) : (
                    <Skeleton className="h-3.5 w-8" />
                  ),
                },
              ]}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

/* ---------- Export row --------------------------------------------------- */

type ExportDef = {
  id: string;
  name: string;
  detail: string;
  /** Known row count; undefined when not prefetched. */
  count?: number;
  pending?: boolean;
  run: () => Promise<string>;
};

function ExportRow({ def }: { def: ExportDef }) {
  const [busy, setBusy] = useState(false);
  const empty = def.count === 0;

  async function go() {
    setBusy(true);
    try {
      const csv = await def.run();
      if (csv.split("\r\n").length <= 1) {
        toast("Nothing to export yet", { description: `${def.name} has no rows.` });
        return;
      }
      downloadCsv(def.id, csv);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t build the export");
    } finally {
      setBusy(false);
    }
  }

  const countText = def.pending ? (
    <Skeleton className="ml-auto h-3.5 w-12" />
  ) : def.count === undefined ? (
    <span className="text-ink-3">On demand</span>
  ) : (
    <>
      {formatNumber(def.count)}{" "}
      <span className="text-ink-3">{def.count === 1 ? "row" : "rows"}</span>
    </>
  );

  return (
    <li className="flex items-center gap-4 px-4 py-3 md:px-5">
      <div className="min-w-0 flex-1">
        <div className="pg-t-h3">{def.name}</div>
        <div className="pg-t-caption">{def.detail}</div>
        <div className="pg-num mt-1 text-[12px] leading-4 text-ink-2 sm:hidden">{countText}</div>
      </div>
      <div className="pg-num hidden w-24 shrink-0 text-right text-[13px] text-ink-2 sm:block">
        {countText}
      </div>
      <Button
        size="sm"
        icon={Download}
        loading={busy}
        disabled={empty}
        title={empty ? "No rows to export yet" : undefined}
        onClick={() => void go()}
        aria-label={`Download ${def.name} as CSV`}
      >
        CSV
      </Button>
    </li>
  );
}
