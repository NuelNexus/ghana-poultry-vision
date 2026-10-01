import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Cpu, Plus, Copy } from "lucide-react";
import { toast } from "sonner";
import { createDevice, listDevices, listHouses, updateDevice } from "@/lib/api/farm.functions";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/app/devices")({ component: Devices });

const TYPE_LABEL: Record<string, string> = {
  pi: "Raspberry Pi (edge AI)",
  sensor: "ESP32 sensor node",
  camera: "ESP32-CAM",
  controller: "Controller",
};

function origin() {
  return typeof window !== "undefined" ? window.location.origin : "";
}

function Devices() {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ deviceId: string; apiKey: string } | null>(null);
  const { canManage } = useAuth();
  const q = useQuery({
    queryKey: ["devices"],
    queryFn: () => listDevices(),
    refetchInterval: 15_000,
  });
  const houses = useQuery({ queryKey: ["houses"], queryFn: () => listHouses() });

  async function update(
    id: string,
    patch: { houseId?: string | null; fanOverride?: "low" | "medium" | "high" | null },
  ) {
    try {
      await updateDevice({ data: { id, ...patch } });
      toast.success("Saved");
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Device management"
        description="Register Raspberry Pi edge-AI units and ESP32 nodes."
      >
        {canManage && (
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Register device
          </button>
        )}
      </PageHeader>

      <Card title="API endpoint">
        <div className="text-xs text-muted-foreground">
          Devices POST readings (and edge-AI results) to:
        </div>
        <code className="block mt-2 px-3 py-2 rounded-md bg-muted text-xs break-all">
          POST {origin()}/api/public/devices/ingest
        </code>
        <div className="mt-2 text-xs text-muted-foreground">
          Headers: <code className="bg-muted px-1 rounded">x-device-id</code>,{" "}
          <code className="bg-muted px-1 rounded">x-api-key</code>. The Pi agent in{" "}
          <code className="bg-muted px-1 rounded">edge/</code> does this for you.
        </div>
      </Card>

      <div className="mt-6">
        {q.data?.length === 0 ? (
          <EmptyState
            icon={Cpu}
            title="No devices registered"
            description="Register your Raspberry Pi to start streaming coop conditions."
          />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2">Device ID</th>
                    <th>Type</th>
                    <th>House</th>
                    <th>Fan</th>
                    <th>Last seen</th>
                    <th>Status</th>
                    {canManage && <th>API key</th>}
                  </tr>
                </thead>
                <tbody>
                  {q.data?.map((d) => (
                    <tr key={d.id} className="border-t border-border">
                      <td className="py-2 font-mono text-xs">{d.device_id}</td>
                      <td className="text-xs">{TYPE_LABEL[d.type] ?? d.type}</td>
                      <td>
                        {canManage ? (
                          <select
                            value={d.house_id ?? ""}
                            onChange={(e) => update(d.id, { houseId: e.target.value || null })}
                            className="px-2 py-1 rounded border border-input bg-background text-xs"
                          >
                            <option value="">— none —</option>
                            {houses.data?.houses.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs">{d.house_name ?? "—"}</span>
                        )}
                      </td>
                      <td>
                        {d.type === "pi" && canManage ? (
                          <select
                            value={d.fan_override ?? ""}
                            title="Override the AI's fan choice"
                            onChange={(e) =>
                              update(d.id, {
                                fanOverride: (e.target.value || null) as
                                  | "low"
                                  | "medium"
                                  | "high"
                                  | null,
                              })
                            }
                            className="px-2 py-1 rounded border border-input bg-background text-xs"
                          >
                            <option value="">AI auto</option>
                            <option value="low">Force low</option>
                            <option value="medium">Force medium</option>
                            <option value="high">Force high</option>
                          </select>
                        ) : (
                          <span className="text-xs">
                            {d.fan_override ?? (d.type === "pi" ? "AI auto" : "—")}
                          </span>
                        )}
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {d.last_seen ? new Date(d.last_seen).toLocaleString() : "Never"}
                      </td>
                      <td>
                        <Badge tone={d.online ? "success" : "default"}>
                          {d.online ? "Online" : "Offline"}
                        </Badge>
                      </td>
                      {canManage && (
                        <td>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(d.api_key);
                              toast.success("API key copied");
                            }}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Copy className="h-3 w-3" /> Copy
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {open && (
        <Register
          houses={houses.data?.houses ?? []}
          onClose={(c) => {
            setOpen(false);
            if (c) setCreated(c);
            q.refetch();
          }}
        />
      )}
      {created && <PiSetup {...created} onClose={() => setCreated(null)} />}
    </div>
  );
}

function Register({
  houses,
  onClose,
}: {
  houses: { id: string; name: string }[];
  onClose: (created?: { deviceId: string; apiKey: string }) => void;
}) {
  const [deviceId, setDeviceId] = useState("");
  const [type, setType] = useState<"pi" | "sensor" | "camera" | "controller">("pi");
  const [location, setLocation] = useState("");
  const [houseId, setHouseId] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await createDevice({
        data: { deviceId, type, location, houseId: houseId || undefined },
      });
      toast.success("Device registered");
      onClose(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form
        onSubmit={submit}
        className="bg-card rounded-lg border border-border w-full max-w-md p-5 space-y-3"
      >
        <h2 className="font-semibold">Register device</h2>
        <input
          placeholder="Device ID (e.g. PI-HOUSE-A)"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          required
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
        >
          {Object.entries(TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={houseId}
          onChange={(e) => setHouseId(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
        >
          <option value="">— Assign to house (optional) —</option>
          {houses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onClose()} className="px-4 py-2 text-sm">
            Cancel
          </button>
          <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm">
            Register
          </button>
        </div>
      </form>
    </div>
  );
}

function PiSetup({
  deviceId,
  apiKey,
  onClose,
}: {
  deviceId: string;
  apiKey: string;
  onClose: () => void;
}) {
  const env = `PG_API_URL=${origin()}\nPG_DEVICE_ID=${deviceId}\nPG_DEVICE_API_KEY=${apiKey}\n`;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg border border-border w-full max-w-lg p-5 space-y-3">
        <h2 className="font-semibold">Device registered</h2>
        <p className="text-sm text-muted-foreground">
          Put this in <code className="bg-muted px-1 rounded">/etc/poultrygrid/agent.env</code> on
          the Raspberry Pi (the installer in{" "}
          <code className="bg-muted px-1 rounded">edge/deploy/install_pi.sh</code> asks for these
          values).
        </p>
        <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto">{env}</pre>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => {
              navigator.clipboard.writeText(env);
              toast.success("Copied");
            }}
            className="inline-flex items-center gap-1 border border-border px-3 py-2 rounded-md text-sm"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
          <button
            onClick={onClose}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
