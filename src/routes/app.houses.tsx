import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Warehouse, Plus, Thermometer, Droplets, Wind, Fan } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createHouse, listFarms, listHouses } from "@/lib/api/farm.functions";
import { AiStatusBadge, PHASE_LABEL, isStale } from "@/components/ai-status";
import { useAuth } from "@/lib/auth";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui-kit";

export const Route = createFileRoute("/app/houses")({ component: Houses });

function Houses() {
  const [open, setOpen] = useState(false);
  const { canManage } = useAuth();
  const q = useQuery({ queryKey: ["houses"], queryFn: () => listHouses(), refetchInterval: 15_000 });
  const houses = { data: q.data?.houses, refetch: q.refetch };
  const latest = { data: q.data?.latest };

  return (
    <div>
      <PageHeader title="Poultry house monitoring" description="Live conditions across all houses.">
        {canManage && (
          <button onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Add house
          </button>
        )}
      </PageHeader>

      {houses.data?.length === 0 ? (
        <EmptyState icon={Warehouse} title="No houses yet" description="Add your first poultry house to start monitoring." />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {houses.data?.map((h) => {
            const r = latest.data?.[h.id];
            const stale = isStale(r);
            return (
              <Card key={h.id} title={h.name} action={
                r && !stale ? <AiStatusBadge status={r.ai_status} /> : <Badge>{r ? "Offline" : "No data"}</Badge>
              }>
                <div className="text-xs text-muted-foreground mb-3">
                  {h.batch_name ?? "No batch"} · {h.bird_count}/{h.capacity} birds
                  {r?.growth_phase && ` · ${PHASE_LABEL[r.growth_phase] ?? r.growth_phase}`}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Stat icon={Thermometer} label="Temp" value={r?.temperature ?? "—"} unit="°C" />
                  <Stat icon={Droplets} label="Humidity" value={r?.humidity ?? "—"} unit="%" />
                  <Stat icon={Wind} label="Gas index" value={r?.gas_index ?? r?.air_quality ?? "—"} />
                  <Stat icon={Fan} label="Fan" value={r?.fan_level ?? (r?.fan_rpm != null ? Math.round(r.fan_rpm) : "—")}
                    unit={r?.fan_level ? undefined : "rpm"} />
                </div>
                {r?.ai_status && r.ai_status !== "healthy" && r.ai_causes?.length ? (
                  <div className="mt-3 text-xs">
                    <span className="font-medium">Why: </span>{r.ai_causes.map((c) => c.label).join(", ")}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {open && <AddHouse onClose={() => { setOpen(false); houses.refetch(); }} />}
    </div>
  );
}

function Stat({ icon: Icon, label, value, unit }: { icon: typeof Thermometer; label: string; value: string | number | null; unit?: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="mt-1 font-semibold">{value ?? "—"}{unit && value !== "—" && <span className="text-xs font-normal ml-0.5">{unit}</span>}</div>
    </div>
  );
}

function AddHouse({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(1000);
  const [birdCount, setBirdCount] = useState(0);
  const [batch, setBatch] = useState("");
  const [batchStart, setBatchStart] = useState("");
  const farms = useQuery({ queryKey: ["farms-list"], queryFn: () => listFarms() });
  const [farmId, setFarmId] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createHouse({ data: {
        farmId: farmId || undefined, name, capacity, birdCount,
        batchName: batch || undefined, batchStartedAt: batchStart || undefined,
      } });
    } catch (err) { return toast.error(err instanceof Error ? err.message : "Failed"); }
    toast.success("House added");
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-card rounded-lg border border-border w-full max-w-md p-5 space-y-3">
        <h2 className="font-semibold">Add poultry house</h2>
        <select value={farmId} onChange={(e) => setFarmId(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm">
          <option value="">— Create default farm —</option>
          {farms.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <input placeholder="House name" value={name} onChange={(e) => setName(e.target.value)} required
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
        <input placeholder="Batch name" value={batch} onChange={(e) => setBatch(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
        <label className="block text-xs text-muted-foreground">
          Chicks placed on (sets flock age for the edge AI)
          <input type="date" value={batchStart} onChange={(e) => setBatchStart(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-md border border-input bg-background text-sm text-foreground" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <input type="number" placeholder="Capacity" value={capacity} onChange={(e) => setCapacity(+e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
          <input type="number" placeholder="Birds" value={birdCount} onChange={(e) => setBirdCount(+e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm">Cancel</button>
          <button type="submit" className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm">Create</button>
        </div>
      </form>
    </div>
  );
}
