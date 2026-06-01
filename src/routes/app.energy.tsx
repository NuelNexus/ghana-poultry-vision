import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sun, BatteryCharging, Zap, PowerOff } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatCard, Card } from "@/components/ui-kit";

export const Route = createFileRoute("/app/energy")({ component: Energy });

function Energy() {
  const q = useQuery({
    queryKey: ["energy"],
    queryFn: async () => (await supabase.from("energy_records").select("*").order("created_at", { ascending: false }).limit(48)).data ?? [],
  });
  const series = (q.data ?? []).slice().reverse().map((r) => ({
    t: new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit" }),
    solar: Number(r.solar_w), consumption: Number(r.consumption_w),
  }));
  const latest = q.data?.[0];

  return (
    <div>
      <PageHeader title="Renewable energy center" description="Solar generation, battery and consumption tracking." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Solar power" value={latest?.solar_w ?? 0} unit="W" icon={Sun} tone="warning" />
        <StatCard label="Battery" value={latest?.battery_pct ?? 0} unit="%" icon={BatteryCharging} tone="success" />
        <StatCard label="Consumption" value={latest?.consumption_w ?? 0} unit="W" icon={Zap} />
        <StatCard label="Outages (30d)" value={0} icon={PowerOff} />
      </div>
      <Card title="Energy flow (last 48h)" className="mt-6">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6 }} />
              <Line dataKey="solar" stroke="var(--color-warning)" strokeWidth={2} dot={false} name="Solar W" />
              <Line dataKey="consumption" stroke="var(--color-primary)" strokeWidth={2} dot={false} name="Load W" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
