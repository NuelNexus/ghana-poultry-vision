import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Cpu, Plus, Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui-kit";

export const Route = createFileRoute("/app/devices")({ component: Devices });

function Devices() {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["devices"],
    queryFn: async () => (await supabase.from("devices").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  return (
    <div>
      <PageHeader title="Device management" description="Register and monitor ESP32 devices.">
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Register device
        </button>
      </PageHeader>

      <Card title="API endpoint">
        <div className="text-xs text-muted-foreground">ESP32 devices POST sensor data to:</div>
        <code className="block mt-2 px-3 py-2 rounded-md bg-muted text-xs break-all">
          POST {typeof window !== "undefined" ? window.location.origin : ""}/api/public/devices/ingest
        </code>
        <div className="mt-2 text-xs text-muted-foreground">Headers: <code className="bg-muted px-1 rounded">x-device-id</code>, <code className="bg-muted px-1 rounded">x-api-key</code></div>
      </Card>

      <div className="mt-6">
        {q.data?.length === 0 ? (
          <EmptyState icon={Cpu} title="No devices registered" description="Register your first ESP32 to start streaming sensor data." />
        ) : (
          <Card>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-2">Device ID</th><th>Type</th><th>Firmware</th><th>Last seen</th><th>Status</th><th>API key</th></tr>
              </thead>
              <tbody>
                {q.data?.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="py-2 font-mono text-xs">{d.device_id}</td>
                    <td>{d.type}</td>
                    <td>{d.firmware_version ?? "—"}</td>
                    <td className="text-xs text-muted-foreground">{d.last_seen ? new Date(d.last_seen).toLocaleString() : "Never"}</td>
                    <td><Badge tone={d.online ? "success" : "default"}>{d.online ? "Online" : "Offline"}</Badge></td>
                    <td>
                      <button onClick={() => { navigator.clipboard.writeText(d.api_key); toast.success("API key copied"); }}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {open && <Register onClose={() => { setOpen(false); q.refetch(); }} />}
    </div>
  );
}

function Register({ onClose }: { onClose: () => void }) {
  const [deviceId, setDeviceId] = useState("");
  const [type, setType] = useState("sensor");
  const [location, setLocation] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const apiKey = crypto.randomUUID().replace(/-/g, "");
    const { error } = await supabase.from("devices").insert({ device_id: deviceId, api_key: apiKey, type, location });
    if (error) return toast.error(error.message);
    toast.success("Device registered. API key copied.");
    navigator.clipboard.writeText(apiKey);
    onClose();
  }
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-card rounded-lg border border-border w-full max-w-md p-5 space-y-3">
        <h2 className="font-semibold">Register ESP32 device</h2>
        <input placeholder="Device ID (e.g. ESP32-001)" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} required
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
        <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm">
          <option value="sensor">Sensor node</option>
          <option value="camera">ESP32-CAM</option>
          <option value="controller">Controller</option>
        </select>
        <input placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 text-sm">Cancel</button>
          <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm">Register</button></div>
      </form>
    </div>
  );
}
