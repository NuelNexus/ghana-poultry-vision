import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, Cpu } from "lucide-react";
import {
  ComposedChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Bar,
  Cell,
} from "recharts";
import { getAiMonitor } from "@/lib/api/farm.functions";
import { PageHeader, Card, EmptyState } from "@/components/ui-kit";
import { AiStatusBadge, AiStatusPanel, STATUS_META } from "@/components/ai-status";
import type { AiStatus } from "@/lib/api/types";

export const Route = createFileRoute("/app/health")({ component: Health });

const RANGES = [1, 6, 24, 72];

function Health() {
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [hours, setHours] = useState(6);
  const q = useQuery({
    queryKey: ["ai-monitor", deviceId, hours],
    queryFn: () => getAiMonitor({ data: { deviceId, hours } }),
    refetchInterval: 10_000,
  });

  const latest = q.data?.latest ?? [];
  const current = latest.find((l) => l.device_id === q.data?.selected);
  const history = q.data?.history ?? [];
  const series = history.map((r) => ({
    t: new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    temp: r.temperature,
    target: r.target_temp,
    gas: r.gas_index,
    hum: r.humidity,
    band: 1,
    status: (r.ai_status ?? "healthy") as AiStatus,
  }));
  const share = (["healthy", "warning", "critical"] as const).map((s) => ({
    s,
    pct: history.length
      ? Math.round((history.filter((r) => r.ai_status === s).length / history.length) * 100)
      : 0,
  }));
  const changes = history
    .filter((r, i) => i > 0 && r.ai_status !== history[i - 1].ai_status)
    .slice(-8)
    .reverse();

  return (
    <div>
      <PageHeader
        title="AI health monitoring"
        description="Live coop condition from the Raspberry Pi edge model."
      >
        <div className="flex gap-2">
          {latest.length > 1 && (
            <select
              value={q.data?.selected ?? ""}
              onChange={(e) => setDeviceId(e.target.value)}
              className="px-3 py-2 rounded-md border border-input bg-background text-sm"
            >
              {latest.map((l) => (
                <option key={l.device_id} value={l.device_id}>
                  {l.house_name ?? l.device_code}
                </option>
              ))}
            </select>
          )}
          <select
            value={hours}
            onChange={(e) => setHours(+e.target.value)}
            className="px-3 py-2 rounded-md border border-input bg-background text-sm"
          >
            {RANGES.map((h) => (
              <option key={h} value={h}>
                Last {h} h
              </option>
            ))}
          </select>
        </div>
      </PageHeader>

      {!q.isPending && latest.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title="Waiting for the Raspberry Pi"
          description="No edge-AI readings yet. Register the Pi under Devices, then run the agent from edge/ (python agent.py, or --simulate to try it without sensors)."
          action={
            <Link to="/app/devices" className="text-sm underline">
              Go to Devices
            </Link>
          }
        />
      ) : (
        <>
          {latest.length > 1 && (
            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
              {latest.map((l) => (
                <button
                  key={l.device_id}
                  onClick={() => setDeviceId(l.device_id)}
                  className={`rounded-lg border p-3 text-left bg-card ${l.device_id === q.data?.selected ? "border-foreground" : "border-border"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{l.house_name ?? l.device_code}</span>
                    <AiStatusBadge status={l.ai_status} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {l.temperature}°C · {l.humidity}% · gas {l.gas_index}
                  </div>
                </button>
              ))}
            </div>
          )}

          {current && <AiStatusPanel r={current} />}

          <div className="grid lg:grid-cols-3 gap-4 mt-6">
            <Card title="Temperature vs age target, with AI status" className="lg:col-span-2">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={30} />
                    <YAxis yAxisId="t" tick={{ fontSize: 11 }} domain={["auto", "auto"]} unit="°" />
                    <YAxis yAxisId="band" hide domain={[0, 12]} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                      }}
                    />
                    <Bar yAxisId="band" dataKey="band" isAnimationActive={false} name="Status" tooltipType="none">
                      {series.map((p, i) => (
                        <Cell key={i} fill={STATUS_META[p.status].color} />
                      ))}
                    </Bar>
                    <Line
                      yAxisId="t"
                      dataKey="temp"
                      stroke="#111"
                      strokeWidth={2}
                      dot={false}
                      name="Temp °C"
                    />
                    <Line
                      yAxisId="t"
                      dataKey="target"
                      stroke="#888"
                      strokeDasharray="5 4"
                      dot={false}
                      name="Target °C"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Coloured strip: AI status for each reading.
              </p>
            </Card>

            <Card title={`Time in each state (${hours} h)`}>
              <ul className="space-y-3">
                {share.map(({ s, pct }) => (
                  <li key={s}>
                    <div className="flex justify-between text-sm">
                      <span>{STATUS_META[s].label}</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                      <div
                        className="h-full"
                        style={{ width: `${pct}%`, background: STATUS_META[s].color }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="text-xs text-muted-foreground mt-4">{history.length} readings</div>
            </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mt-6">
            <Card title="Gas index & humidity" className="lg:col-span-2">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={30} />
                    <YAxis yAxisId="g" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="h" orientation="right" tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                      }}
                    />
                    <Line
                      yAxisId="g"
                      dataKey="gas"
                      stroke="#d97706"
                      strokeWidth={2}
                      dot={false}
                      name="Gas index"
                    />
                    <Line
                      yAxisId="h"
                      dataKey="hum"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={false}
                      name="Humidity %"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card
              title="Status changes"
              action={<Activity className="h-4 w-4 text-muted-foreground" />}
            >
              {changes.length ? (
                <ul className="space-y-3">
                  {changes.map((c) => (
                    <li key={c.id} className="flex items-start gap-3 text-sm">
                      <AiStatusBadge status={c.ai_status} />
                      <div className="min-w-0">
                        <div className="truncate">
                          {c.ai_causes?.map((x) => x.label).join(", ") || "Back to normal"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleString()}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Stable over this period.</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
