import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Warehouse, Plus, Thermometer, Droplets, Wind, Cpu } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui-kit";

export const Route = createFileRoute("/app/houses")({ component: Houses });

function Houses() {
  const [open, setOpen] = useState(false);
  const houses = useQuery({
    queryKey: ["houses-full"],
    queryFn: async () => {
      const { data } = await supabase.from("poultry_houses")
        .select("id,name,bird_count,capacity,batch_name,farm_id,farms(name)").order("created_at");
      return data ?? [];
    },
  });

  const latest = useQuery({
    queryKey: ["houses-latest-readings"],
    queryFn: async () => {
      const { data } = await supabase.from("sensor_readings")
        .select("house_id,temperature,humidity,air_quality,water_level,feed_level,created_at")
        .order("created_at", { ascending: false }).limit(200);
      const byHouse: Record<string, NonNullable<typeof data>[number]> = {};
      (data ?? []).forEach((r) => { if (r.house_id && !byHouse[r.house_id]) byHouse[r.house_id] = r; });
      return byHouse;
    },
  });

  return (
    <div>
      <PageHeader title="Poultry house monitoring" description="Live conditions across all houses.">
        <button onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Add house
        </button>
      </PageHeader>

      {houses.data?.length === 0 ? (
        <EmptyState icon={Warehouse} title="No houses yet" description="Add your first poultry house to start monitoring." />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {houses.data?.map((h) => {
            const r = latest.data?.[h.id];
            return (
              <Card key={h.id} title={h.name} action={<Badge tone={r ? "success" : "default"}>{r ? "Online" : "No data"}</Badge>}>
                <div className="text-xs text-muted-foreground mb-3">
                  {h.batch_name ?? "No batch"} · {h.bird_count}/{h.capacity} birds
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Stat icon={Thermometer} label="Temp" value={r?.temperature ?? "—"} unit="°C" />
                  <Stat icon={Droplets} label="Humidity" value={r?.humidity ?? "—"} unit="%" />
                  <Stat icon={Wind} label="Air Q" value={r?.air_quality ?? "—"} />
                  <Stat icon={Cpu} label="Water" value={r?.water_level ?? "—"} unit="%" />
                </div>
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
  const farms = useQuery({
    queryKey: ["farms-list"],
    queryFn: async () => (await supabase.from("farms").select("id,name").order("name")).data ?? [],
  });
  const [farmId, setFarmId] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let fid = farmId;
    if (!fid) {
      const { data: f, error } = await supabase.from("farms").insert({ name: "Main Farm" }).select("id").single();
      if (error) return toast.error(error.message);
      fid = f.id;
    }
    const { error } = await supabase.from("poultry_houses").insert({
      name, capacity, bird_count: birdCount, batch_name: batch || null, farm_id: fid,
    });
    if (error) return toast.error(error.message);
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
