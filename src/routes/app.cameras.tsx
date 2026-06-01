import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Camera as CamIcon, Plus, Maximize2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui-kit";

export const Route = createFileRoute("/app/cameras")({ component: Cameras });

function Cameras() {
  const [open, setOpen] = useState(false);
  const [fs, setFs] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["cameras"],
    queryFn: async () => (await supabase.from("cameras").select("*").order("name")).data ?? [],
  });

  return (
    <div>
      <PageHeader title="Camera monitoring" description="Live ESP32-CAM streams.">
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Add camera
        </button>
      </PageHeader>

      {q.data?.length === 0 ? (
        <EmptyState icon={CamIcon} title="No cameras yet" description="Register an ESP32-CAM stream URL." />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {q.data?.map((c) => (
            <Card key={c.id} title={c.name} action={<Badge tone={c.status === "online" ? "success" : "default"}>{c.status}</Badge>}>
              <div className="aspect-video rounded-md bg-muted overflow-hidden flex items-center justify-center relative">
                {c.stream_url ? (
                  <img src={c.stream_url} alt={c.name} className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <CamIcon className="h-10 w-10 text-muted-foreground" />
                )}
                <button onClick={() => setFs(c.stream_url || null)}
                  className="absolute bottom-2 right-2 bg-card/80 backdrop-blur px-2 py-1 rounded text-xs flex items-center gap-1">
                  <Maximize2 className="h-3 w-3" /> Fullscreen
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {open && <AddCamera onClose={() => { setOpen(false); q.refetch(); }} />}
      {fs && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setFs(null)}>
          <img src={fs} alt="" className="max-w-full max-h-full" />
        </div>
      )}
    </div>
  );
}

function AddCamera({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("cameras").insert({ name, stream_url: url, status: "online" });
    if (error) return toast.error(error.message);
    toast.success("Camera added");
    onClose();
  }
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-card rounded-lg border border-border w-full max-w-md p-5 space-y-3">
        <h2 className="font-semibold">Add ESP32-CAM</h2>
        <input placeholder="Camera name" value={name} onChange={(e) => setName(e.target.value)} required
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
        <input placeholder="MJPEG stream URL" value={url} onChange={(e) => setUrl(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 text-sm">Cancel</button>
          <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm">Add</button></div>
      </form>
    </div>
  );
}
