import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Recycle, Trash2, Sprout, Gauge } from "lucide-react";
import { listBiogas } from "@/lib/api/farm.functions";
import { PageHeader, StatCard, Card } from "@/components/ui-kit";

export const Route = createFileRoute("/app/biogas")({ component: Biogas });

function Biogas() {
  const q = useQuery({
    queryKey: ["biogas"],
    queryFn: () => listBiogas(),
  });
  const totals = (q.data ?? []).reduce((a, r) => ({
    gas: a.gas + Number(r.gas_m3), waste: a.waste + Number(r.waste_kg),
    fert: a.fert + Number(r.fertilizer_kg), eff: r.efficiency_pct ?? a.eff,
  }), { gas: 0, waste: 0, fert: 0, eff: 0 });

  return (
    <div>
      <PageHeader title="Waste-to-energy system" description="Biogas production, waste and fertilizer tracking." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Biogas (30d)" value={totals.gas.toFixed(1)} unit="m³" icon={Recycle} tone="success" />
        <StatCard label="Waste processed" value={totals.waste.toFixed(0)} unit="kg" icon={Trash2} />
        <StatCard label="Fertilizer produced" value={totals.fert.toFixed(0)} unit="kg" icon={Sprout} tone="success" />
        <StatCard label="System efficiency" value={Number(totals.eff).toFixed(0)} unit="%" icon={Gauge} />
      </div>
      <Card title="Recent records" className="mt-6">
        {q.data?.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-2">Date</th><th>Gas (m³)</th><th>Waste (kg)</th><th>Fertilizer (kg)</th></tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>{r.gas_m3}</td><td>{r.waste_kg}</td><td>{r.fertilizer_kg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-muted-foreground">No records yet.</p>}
      </Card>
    </div>
  );
}
