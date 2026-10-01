import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Egg, Plus, Thermometer, Droplets } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createHatchery, listFarms, listHatcheries } from "@/lib/api/farm.functions";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui-kit";

export const Route = createFileRoute("/app/hatchery")({ component: Hatchery });

function Hatchery() {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["hatcheries"],
    queryFn: () => listHatcheries(),
  });

  return (
    <div>
      <PageHeader title="Hatchery management" description="Monitor incubators, egg counts and hatch progress.">
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New batch
        </button>
      </PageHeader>

      {q.data?.length === 0 ? (
        <EmptyState icon={Egg} title="No hatchery batches" description="Start your first incubation batch." />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {q.data?.map((h) => {
            const progress = h.expected_hatch_at && h.started_at
              ? Math.min(100, Math.max(0, ((Date.now() - new Date(h.started_at).getTime()) / (new Date(h.expected_hatch_at).getTime() - new Date(h.started_at).getTime())) * 100))
              : 0;
            return (
              <Card key={h.id} title={h.name} action={<Badge tone="success">{Math.round(progress)}%</Badge>}>
                <div className="text-xs text-muted-foreground">{h.farm_name}</div>
                <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                  <div><span className="text-muted-foreground">Eggs</span><div className="font-semibold">{h.egg_count}</div></div>
                  <div><span className="text-muted-foreground">Hatched</span><div className="font-semibold">{h.hatched_count}</div></div>
                  <div className="flex items-center gap-1 text-muted-foreground"><Thermometer className="h-3 w-3" />{h.temperature ?? "—"}°C</div>
                  <div className="flex items-center gap-1 text-muted-foreground"><Droplets className="h-3 w-3" />{h.humidity ?? "—"}%</div>
                </div>
                {h.expected_hatch_at && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Expected hatch: {new Date(h.expected_hatch_at).toLocaleDateString()}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {open && <NewBatch onClose={() => { setOpen(false); q.refetch(); }} />}
    </div>
  );
}

function NewBatch({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [eggCount, setEggCount] = useState(100);
  const farms = useQuery({ queryKey: ["farms-list"], queryFn: () => listFarms() });
  const [farmId, setFarmId] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createHatchery({ data: { farmId: farmId || undefined, name, eggCount } });
    } catch (err) { return toast.error(err instanceof Error ? err.message : "Failed"); }
    toast.success("Batch started");
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-card rounded-lg border border-border w-full max-w-md p-5 space-y-3">
        <h2 className="font-semibold">New hatchery batch</h2>
        <select value={farmId} onChange={(e) => setFarmId(e.target.value)} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm">
          <option value="">— Create default farm —</option>
          {farms.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <input placeholder="Batch name" value={name} onChange={(e) => setName(e.target.value)} required
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
        <input type="number" placeholder="Egg count" value={eggCount} onChange={(e) => setEggCount(+e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 text-sm">Cancel</button>
          <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm">Start</button></div>
      </form>
    </div>
  );
}
