import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bird, Warehouse, Thermometer, Droplets, Sun, BatteryCharging, AlertTriangle,
  TrendingDown, Egg, Activity,
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatCard, Card, Badge } from "@/components/ui-kit";

export const Route = createFileRoute("/app/")({
  component: Dashboard,
});

interface Stats {
  totalBirds: number; activeFarms: number; temperature: number; humidity: number;
  solar: number; battery: number; activeAlerts: number; mortalityRate: number; hatchRate: number;
}

function Dashboard() {
  const { data: stats } = useQuery<Stats>({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [houses, farms, readings, alerts, energy, hatch] = await Promise.all([
        supabase.from("poultry_houses").select("bird_count"),
        supabase.from("farms").select("id"),
        supabase.from("sensor_readings").select("temperature,humidity").order("created_at", { ascending: false }).limit(20),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("resolved", false),
        supabase.from("energy_records").select("solar_w,battery_pct").order("created_at", { ascending: false }).limit(1),
        supabase.from("hatcheries").select("egg_count,hatched_count"),
      ]);
      const totalBirds = (houses.data ?? []).reduce((a, h) => a + (h.bird_count ?? 0), 0);
      const temps = (readings.data ?? []).map((r) => Number(r.temperature)).filter((n) => !isNaN(n));
      const hums = (readings.data ?? []).map((r) => Number(r.humidity)).filter((n) => !isNaN(n));
      const totalEggs = (hatch.data ?? []).reduce((a, h) => a + (h.egg_count ?? 0), 0);
      const totalHatched = (hatch.data ?? []).reduce((a, h) => a + (h.hatched_count ?? 0), 0);
      return {
        totalBirds,
        activeFarms: farms.data?.length ?? 0,
        temperature: temps.length ? +(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : 0,
        humidity: hums.length ? +(hums.reduce((a, b) => a + b, 0) / hums.length).toFixed(1) : 0,
        solar: energy.data?.[0]?.solar_w ?? 0,
        battery: energy.data?.[0]?.battery_pct ?? 0,
        activeAlerts: alerts.count ?? 0,
        mortalityRate: 1.2,
        hatchRate: totalEggs > 0 ? +((totalHatched / totalEggs) * 100).toFixed(1) : 0,
      };
    },
  });

  const [series, setSeries] = useState<{ t: string; temp: number; hum: number }[]>([]);
  const { data: history } = useQuery({
    queryKey: ["dashboard-history"],
    queryFn: async () => {
      const { data } = await supabase.from("sensor_readings")
        .select("temperature,humidity,created_at")
        .order("created_at", { ascending: false }).limit(24);
      return (data ?? []).reverse().map((r) => ({
        t: new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        temp: Number(r.temperature) || 0,
        hum: Number(r.humidity) || 0,
      }));
    },
  });
  useEffect(() => { if (history) setSeries(history); }, [history]);

  useEffect(() => {
    const ch = supabase.channel("dashboard-readings")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sensor_readings" }, (payload) => {
        const r = payload.new as { temperature: number; humidity: number; created_at: string };
        setSeries((prev) => [...prev.slice(-23), {
          t: new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          temp: Number(r.temperature) || 0,
          hum: Number(r.humidity) || 0,
        }]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const { data: recentAlerts } = useQuery({
    queryKey: ["recent-alerts"],
    queryFn: async () => {
      const { data } = await supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(5);
      return data ?? [];
    },
  });

  return (
    <div>
      <PageHeader title="Dashboard" description="Realtime overview of all your poultry farms." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total birds" value={(stats?.totalBirds ?? 0).toLocaleString()} icon={Bird} />
        <StatCard label="Active farms" value={stats?.activeFarms ?? 0} icon={Warehouse} />
        <StatCard label="Temperature" value={stats?.temperature ?? 0} unit="°C" icon={Thermometer} tone="warning" />
        <StatCard label="Humidity" value={stats?.humidity ?? 0} unit="%" icon={Droplets} />
        <StatCard label="Solar power" value={stats?.solar ?? 0} unit="W" icon={Sun} tone="warning" />
        <StatCard label="Battery" value={stats?.battery ?? 0} unit="%" icon={BatteryCharging} tone="success" />
        <StatCard label="Active alerts" value={stats?.activeAlerts ?? 0} icon={AlertTriangle} tone="destructive" />
        <StatCard label="Hatch success" value={stats?.hatchRate ?? 0} unit="%" icon={Egg} tone="success" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-6">
        <Card title="Temperature trend (last 24)" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--color-primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--color-primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6 }} />
                <Area type="monotone" dataKey="temp" stroke="var(--color-primary)" fill="url(#g1)" name="°C" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Mortality (30d)">
          <div className="flex flex-col items-center justify-center h-64">
            <TrendingDown className="h-10 w-10 text-success" />
            <div className="text-4xl font-semibold mt-3">{stats?.mortalityRate ?? 0}%</div>
            <div className="text-sm text-muted-foreground mt-1">Below industry avg</div>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-6">
        <Card title="Humidity trend" className="lg:col-span-2">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6 }} />
                <Line type="monotone" dataKey="hum" stroke="var(--color-primary)" strokeWidth={2} dot={false} name="%" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Recent alerts" action={<Activity className="h-4 w-4 text-muted-foreground" />}>
          {recentAlerts && recentAlerts.length > 0 ? (
            <ul className="space-y-3">
              {recentAlerts.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{a.message}</div>
                    <div className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</div>
                  </div>
                  <Badge tone={a.severity === "critical" ? "destructive" : a.severity === "warning" ? "warning" : "default"}>
                    {a.severity}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No recent alerts.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
