import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Camera, Check, Copy, Cpu, Eye, EyeOff, Lock, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  createCamera,
  createDevice,
  listCameras,
  listDevices,
  listHouses,
  updateDevice,
} from "@/lib/api/farm.functions";
import type { Camera as CameraRow, FanLevel } from "@/lib/api/types";
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Metric,
  MetricGrid,
  Modal,
  PageHeader,
  RelativeTime,
  Section,
  Select,
  SkeletonMetrics,
  SkeletonRows,
  StatusPill,
  buttonClass,
  formatDateTime,
  formatRelative,
  useNow,
  type Column,
} from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import { cameraUrls } from "@/lib/esp32cam";

export const Route = createFileRoute("/app/devices")({ component: Devices });

/**
 * The PoultryGrid kit is two units plus a camera:
 *   unit 1, incubator & brooder: a Raspberry Pi edge node (sensors + fan + AI)
 *   unit 2, coop: an ESP32 controller (two zones, fans, lamps, water sensor)
 * Both post readings with an API key. The ESP32-CAM lives in the cameras table
 * because it never posts to the app.
 */
const TYPE_LABEL: Record<string, string> = {
  pi: "Unit 1 · Incubator & brooder (Pi)",
  coop: "Unit 2 · Coop (ESP32)",
};

type Kind = "pi" | "coop" | "cam";
const KIND_LABEL: Record<Kind, string> = {
  pi: "Unit 1 · Incubator & brooder (Raspberry Pi)",
  coop: "Unit 2 · Coop controller (ESP32)",
  cam: "ESP32-CAM camera",
};
type Created = { deviceId: string; apiKey: string; kind: "pi" | "coop" };

const FAN_LABEL: Record<FanLevel, string> = { on: "On", off: "Off" };

const CELL_SELECT =
  "h-8 w-auto min-w-36 text-[13px] max-md:h-10 max-md:w-full max-md:min-w-0 max-md:text-[16px]";

type DeviceRow = Awaited<ReturnType<typeof listDevices>>[number];
type Patch = { houseId?: string | null; fanOverride?: FanLevel | null };

function origin() {
  return typeof window !== "undefined" ? window.location.origin : "";
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
    return true;
  } catch {
    toast.error(`Couldn’t copy. Select the ${what.toLowerCase()} and copy it manually.`);
    return false;
  }
}

function Devices() {
  const { canManage } = useAuth();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerKind, setRegisterKind] = useState<Kind>("pi");
  const [created, setCreated] = useState<Created | null>(null);
  const [saving, setSaving] = useState<Record<string, Patch>>({});
  const now = useNow(15_000);

  const q = useQuery({
    queryKey: ["devices"],
    queryFn: () => listDevices(),
    refetchInterval: 15_000,
  });
  const houses = useQuery({ queryKey: ["houses"], queryFn: () => listHouses() });
  const houseList = houses.data?.houses ?? [];
  const cams = useQuery({ queryKey: ["cameras"], queryFn: () => listCameras() });

  function openRegister(kind: Kind) {
    setRegisterKind(kind);
    setRegisterOpen(true);
  }

  async function update(d: DeviceRow, patch: Patch) {
    setSaving((s) => ({ ...s, [d.id]: { ...s[d.id], ...patch } }));
    try {
      await updateDevice({ data: { id: d.id, ...patch } });
      await q.refetch();
      if (patch.fanOverride !== undefined) {
        toast.success(
          d.online
            ? `${d.device_id}: fan ${patch.fanOverride ? `forced ${patch.fanOverride}` : "back to AI auto"}. Applies on the next upload.`
            : `${d.device_id} is offline. The fan setting applies when it reconnects.`,
        );
      } else {
        toast.success(`${d.device_id} assigned to ${houseName(patch.houseId)}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t save the change");
    } finally {
      setSaving((s) => {
        const { [d.id]: _drop, ...rest } = s;
        return rest;
      });
    }
  }

  function houseName(id: string | null | undefined) {
    if (!id) return "no house";
    return houseList.find((h) => h.id === id)?.name ?? "house";
  }

  const devices = q.data;
  const online = devices?.filter((d) => d.online).length ?? 0;
  const never = devices?.filter((d) => !d.last_seen).length ?? 0;
  const lastSeen = devices
    ?.map((d) => d.last_seen)
    .filter((s): s is string => !!s)
    .sort()
    .at(-1);

  const columns: Column<DeviceRow>[] = [
    {
      key: "id",
      header: "Device ID",
      mobile: "title",
      cell: (d) => (
        <div className="min-w-0">
          <div className="pg-mono truncate text-[13px] font-medium text-ink">{d.device_id}</div>
          {d.location && <div className="pg-t-caption truncate">{d.location}</div>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobile: "status",
      className: "w-[1%] whitespace-nowrap",
      cell: (d) =>
        d.online ? (
          <StatusPill status="ok">Online</StatusPill>
        ) : d.last_seen ? (
          <StatusPill status="offline" title={`Last seen ${formatRelative(d.last_seen, now)}`}>
            Offline
          </StatusPill>
        ) : (
          <StatusPill status="offline">Never connected</StatusPill>
        ),
    },
    {
      key: "seen",
      header: "Last seen",
      mobile: "wide",
      className: "whitespace-nowrap",
      cell: (d) => <RelativeTime iso={d.last_seen} className="text-ink-2" />,
    },
    {
      key: "type",
      header: "Type",
      className: "whitespace-nowrap",
      mobile: "hide",
      cell: (d) => <span className="text-ink-2">{TYPE_LABEL[d.type] ?? d.type}</span>,
    },
    {
      key: "house",
      header: "House",
      cell: (d) => {
        const pending = saving[d.id]?.houseId;
        if (!canManage) return <span className="text-ink-2">{d.house_name ?? "Unassigned"}</span>;
        return (
          <Select
            aria-label={`House for ${d.device_id}`}
            name={`house-${d.id}`}
            className={CELL_SELECT}
            value={(pending !== undefined ? pending : d.house_id) ?? ""}
            disabled={pending !== undefined || houses.isPending}
            onChange={(e) => update(d, { houseId: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {houseList.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      key: "fan",
      header: "Fan",
      cell: (d) => {
        if (d.type !== "pi") return <span className="text-ink-3">—</span>;
        const pending = saving[d.id]?.fanOverride;
        const value = pending !== undefined ? pending : d.fan_override;
        if (!canManage)
          return (
            <span className={value ? "text-ink" : "text-ink-2"}>
              {value ? `Forced ${value}` : "AI auto"}
            </span>
          );
        return (
          <Select
            aria-label={`Fan override for ${d.device_id}`}
            name={`fan-${d.id}`}
            className={CELL_SELECT}
            value={value ?? ""}
            disabled={pending !== undefined}
            onChange={(e) =>
              update(d, { fanOverride: (e.target.value || null) as FanLevel | null })
            }
          >
            <option value="">AI auto</option>
            {(Object.keys(FAN_LABEL) as FanLevel[]).map((l) => (
              <option key={l} value={l}>
                Force {FAN_LABEL[l].toLowerCase()}
              </option>
            ))}
          </Select>
        );
      },
    },
    ...(canManage
      ? [
          {
            key: "key",
            header: "API key",
            mobile: "hide" as const,
            className: "whitespace-nowrap",
            cell: (d: DeviceRow) => <ApiKeyCell device={d} />,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Devices"
        meta={
          devices ? (
            <>
              <span>
                {devices.length} {devices.length === 1 ? "unit" : "units"} · {online} online
                {cams.data
                  ? ` · ${cams.data.length} ${cams.data.length === 1 ? "camera" : "cameras"}`
                  : ""}
              </span>
              <RelativeTime iso={lastSeen} prefix="Last check-in" />
            </>
          ) : undefined
        }
        className="mb-0 md:mb-0"
      >
        {canManage ? (
          devices?.length === 0 ? null : (
            <Button variant="primary" icon={Plus} onClick={() => openRegister("pi")}>
              Add device
            </Button>
          )
        ) : devices?.length === 0 ? null : (
          <RoleNote>Adding and editing devices needs a manager account.</RoleNote>
        )}
      </PageHeader>

      <Section title="Units">
        {q.isPending ? (
          <div className="flex flex-col gap-4">
            <SkeletonMetrics count={4} cols={4} />
            <SkeletonRows rows={2} cols={6} />
          </div>
        ) : q.isError || !devices ? (
          <ErrorState
            title="Couldn’t load devices"
            error={q.error}
            onRetry={() => void q.refetch()}
          />
        ) : devices.length === 0 ? (
          <EmptyState
            title="No units registered"
            description="Register unit 1 (the incubator & brooder Pi) or unit 2 (the coop ESP32) to get its API key. Check-ins, house and fan mode show here."
            action={
              canManage ? (
                <Button variant="primary" icon={Plus} onClick={() => openRegister("pi")}>
                  Register a unit
                </Button>
              ) : undefined
            }
            note={!canManage ? "Ask a farm manager to register the units." : undefined}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <MetricGrid cols={4} className="max-md:hidden">
              <Metric
                label="Online"
                value={online}
                unit={` / ${devices.length}`}
                status={online > 0 ? "ok" : "offline"}
              />
              <Metric
                label="Offline"
                value={devices.length - online - never}
                sub="Missed 3 check-ins (90 s)"
              />
              <Metric label="Never connected" value={never} sub="Registered, no data yet" />
              <Metric
                label="Last check-in"
                value={lastSeen ? formatRelative(lastSeen, now).replace(/ ago$/, "") : null}
                unit={lastSeen ? " ago" : undefined}
                sub={lastSeen ? formatDateTime(lastSeen) : "The Pi hasn’t reported yet"}
              />
            </MetricGrid>
            <DataTable
              caption="Raspberry Pi devices"
              rowKey={(d) => d.id}
              rows={devices}
              columns={columns}
            />
          </div>
        )}
      </Section>

      <CameraSection
        cams={cams.data}
        pending={cams.isPending}
        error={cams.isError ? cams.error : null}
        onRetry={() => void cams.refetch()}
        canManage={canManage}
        onAdd={() => openRegister("cam")}
      />

      <SetupSection />

      <RegisterModal
        open={registerOpen}
        initialKind={registerKind}
        onOpenChange={setRegisterOpen}
        houses={houseList}
        onCreated={(c) => {
          setRegisterOpen(false);
          setCreated(c);
          void q.refetch();
        }}
        onCameraAdded={() => {
          setRegisterOpen(false);
          void cams.refetch();
        }}
      />
      <CreatedModal created={created} onClose={() => setCreated(null)} />
    </div>
  );
}

function RoleNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="pg-t-caption inline-flex items-center gap-1.5">
      <Lock className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
      {children}
    </p>
  );
}

function ApiKeyCell({ device }: { device: DeviceRow }) {
  const [shown, setShown] = useState(false);
  if (!device.api_key) return <span className="text-ink-3">Hidden</span>;
  const masked = `••••••••${device.api_key.slice(-4)}`;
  return (
    <div className="flex items-center gap-1">
      <code className="pg-mono mr-1 text-[12px] text-ink-2">{shown ? device.api_key : masked}</code>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={shown ? EyeOff : Eye}
        aria-label={
          shown ? `Hide API key for ${device.device_id}` : `Reveal API key for ${device.device_id}`
        }
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
      />
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={Copy}
        aria-label={`Copy API key for ${device.device_id}`}
        onClick={() => void copyText(device.api_key, "API key")}
      />
    </div>
  );
}

function CameraSection({
  cams,
  pending,
  error,
  onRetry,
  canManage,
  onAdd,
}: {
  cams: CameraRow[] | undefined;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  canManage: boolean;
  onAdd: () => void;
}) {
  const columns: Column<CameraRow>[] = [
    {
      key: "name",
      header: "Name",
      mobile: "title",
      cell: (c) => <span className="font-medium text-ink">{c.name}</span>,
    },
    {
      key: "house",
      header: "House",
      cell: (c) => <span className="text-ink-2">{c.house_name ?? "Unassigned"}</span>,
    },
    {
      key: "stream",
      header: "Stream",
      cell: (c) =>
        c.stream_url ? (
          <code className="pg-mono text-[12px] break-all text-ink-2">{c.stream_url}</code>
        ) : (
          <span className="text-ink-3">No URL</span>
        ),
    },
    {
      key: "snap",
      header: "Snapshot",
      mobile: "hide",
      cell: (c) => {
        const snap = c.stream_url ? cameraUrls(c.stream_url).snapshot : null;
        return snap ? (
          <code className="pg-mono text-[12px] break-all text-ink-2">{snap}</code>
        ) : (
          <span className="text-ink-3">—</span>
        );
      },
    },
  ];

  return (
    <Section
      title="ESP32-CAM"
      description="The camera streams straight to your browser, so whether it’s reachable shows on the Cameras page."
      action={
        cams?.length ? (
          <Link to="/app/cameras" className={buttonClass({ size: "sm" })}>
            Open cameras
          </Link>
        ) : undefined
      }
    >
      {pending ? (
        <SkeletonRows rows={1} cols={4} />
      ) : error || !cams ? (
        <ErrorState title="Couldn’t load cameras" error={error} onRetry={onRetry} />
      ) : cams.length === 0 ? (
        <EmptyState
          title="No camera added"
          description="Add the ESP32-CAM by its stream URL to watch the house on the Cameras page."
          action={
            canManage ? (
              <Button icon={Plus} onClick={onAdd}>
                Add camera
              </Button>
            ) : undefined
          }
          note={!canManage ? "Ask a farm manager to add the camera." : undefined}
        />
      ) : (
        <DataTable caption="Cameras" rowKey={(c) => c.id} rows={cams} columns={columns} />
      )}
    </Section>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-5 text-ink-2 marker:text-ink-3">
      {children}
    </ol>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="pg-mono rounded bg-sunken px-1 py-px text-[12px] break-all text-ink">
      {children}
    </code>
  );
}

function SetupSection() {
  const url = `${origin()}/api/public/devices/ingest`;
  return (
    <Section
      title="Set up"
      description="The farm runs one Raspberry Pi with its sensors and fan, and one ESP32-CAM."
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-labelledby="setup-pi" className="pg-panel min-w-0 p-4 md:p-5">
          <h3 id="setup-pi" className="pg-t-h3 mb-1 flex items-center gap-2">
            <Cpu className="size-4 text-ink-3" aria-hidden strokeWidth={1.75} />
            Raspberry Pi edge node
          </h3>
          <p className="pg-t-caption mb-3">
            DHT22, MQ-135 and LDR (through an ADS1115, or their DO pins), and a relay for the fan.
            Runs the AI model and switches the fan on or off.
          </p>
          <Steps>
            <li>
              Register the Pi here and copy the <Code>agent.env</Code> it shows. It holds the device
              ID and API key.
            </li>
            <li>
              On the Pi, clone this repo and run <Code>sudo edge/deploy/install_pi.sh</Code>. It
              asks for the app URL, device ID and key, then starts the{" "}
              <Code>poultrygrid-agent</Code> service.
            </li>
            <li>
              Check the wiring with <Code>python test_sensors.py</Code>, then calibrate the MQ-135
              in clean air with <Code>python agent.py calibrate</Code>.
            </li>
            <li>
              Assign the Pi to a house above and set that house’s chick placement date so the model
              knows the flock age.
            </li>
          </Steps>
          <dl className="mt-4 divide-y divide-hairline border-t border-hairline text-[13px] max-md:hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <dt className="pg-t-label w-20 shrink-0">Endpoint</dt>
              <dd className="flex min-w-0 flex-1 items-center gap-2">
                <code className="pg-mono min-w-0 flex-1 text-[12px] break-all text-ink">
                  <span className="mr-1.5 text-ink-3">POST</span>
                  {url}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={Copy}
                  onClick={() => void copyText(url, "Endpoint URL")}
                  aria-label="Copy endpoint URL"
                />
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
              <dt className="pg-t-label w-20 shrink-0">Headers</dt>
              <dd className="flex flex-wrap gap-2">
                <Code>x-device-id</Code>
                <Code>x-api-key</Code>
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
              <dt className="pg-t-label w-20 shrink-0">Response</dt>
              <dd className="min-w-0 flex-1 leading-[18px] text-ink-2">
                The flock age and any fan override, so changes here reach the Pi on its next upload
                (about every 30 s).
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="setup-cam" className="pg-panel min-w-0 p-4 md:p-5">
          <h3 id="setup-cam" className="pg-t-h3 mb-1 flex items-center gap-2">
            <Camera className="size-4 text-ink-3" aria-hidden strokeWidth={1.75} />
            ESP32-CAM
          </h3>
          <p className="pg-t-caption mb-3">
            Live video only. It has no API key and sends nothing to the app: your browser opens its
            stream directly.
          </p>
          <Steps>
            <li>
              Flash the standard <Code>CameraWebServer</Code> example from the Arduino ESP32 core
              (board “AI Thinker ESP32-CAM”) with the farm Wi-Fi name and password.
            </li>
            <li>
              Open the serial monitor at 115200 baud and note the IP it prints. Reserve that IP in
              the router so it doesn’t change.
            </li>
            <li>
              Add the camera here with its stream URL, <Code>http://&lt;cam-ip&gt;:81/stream</Code>.
              Snapshots come from <Code>http://&lt;cam-ip&gt;/capture</Code>.
            </li>
            <li>
              Watch it on the Cameras page from a phone or laptop on the same Wi-Fi. The firmware
              serves one stream viewer at a time.
            </li>
          </Steps>
        </section>
      </div>
    </Section>
  );
}

function RegisterModal({
  open,
  initialKind,
  onOpenChange,
  houses,
  onCreated,
  onCameraAdded,
}: {
  open: boolean;
  initialKind: Kind;
  onOpenChange: (o: boolean) => void;
  houses: { id: string; name: string }[];
  onCreated: (c: Created) => void;
  onCameraAdded: () => void;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [deviceId, setDeviceId] = useState("");
  const [name, setName] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [location, setLocation] = useState("");
  const [houseId, setHouseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ id?: string; name?: string; url?: string; form?: string }>(
    {},
  );

  // Pick up the kind the opener asked for (header button vs the camera section).
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setKind(initialKind);
  }

  function reset() {
    setDeviceId("");
    setName("");
    setStreamUrl("");
    setLocation("");
    setHouseId("");
    setErrors({});
  }

  async function submitUnit(type: "pi" | "coop") {
    const id = deviceId.trim();
    if (!id) return setErrors({ id: "Enter a device ID." });
    setBusy(true);
    setErrors({});
    try {
      const res = await createDevice({
        data: {
          deviceId: id,
          type,
          location: location.trim(),
          houseId: houseId || undefined,
        },
      });
      reset();
      onCreated({ ...res, kind: type });
    } catch (err) {
      setErrors({ id: err instanceof Error ? err.message : "Couldn’t register the unit" });
    } finally {
      setBusy(false);
    }
  }

  async function submitCam() {
    const next: typeof errors = {};
    const url = streamUrl.trim();
    if (!name.trim()) next.name = "Enter a name.";
    if (!url) next.url = "Enter the camera’s stream URL.";
    else if (!/^https?:\/\/\S+$/i.test(url))
      next.url = "Use a full URL starting with http://, for example http://192.168.1.40:81/stream";
    setErrors(next);
    if (next.name || next.url) return;
    setBusy(true);
    try {
      await createCamera({
        data: { name: name.trim(), streamUrl: url, houseId: houseId || undefined },
      });
      toast.success(`${name.trim()} added`, {
        description: "Open Cameras from a device on the farm Wi-Fi to watch it.",
      });
      reset();
      onCameraAdded();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : "Couldn’t add the camera" });
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void (kind === "cam" ? submitCam() : submitUnit(kind));
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Add device"
      description={
        kind === "pi"
          ? "You’ll get the Pi’s API key and agent.env after this step."
          : kind === "coop"
            ? "You’ll get the coop’s API key and the lines for its config.h after this step."
            : "The camera needs no key. Your browser opens its stream directly."
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form="register-device" loading={busy}>
            {kind === "pi" ? "Register Pi" : kind === "coop" ? "Register coop" : "Add camera"}
          </Button>
        </>
      }
    >
      <form id="register-device" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Type">
          <Select
            name="type"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setErrors({});
            }}
          >
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        {kind !== "cam" ? (
          <Field
            label="Device ID"
            required
            hint={
              kind === "pi"
                ? "Unique, up to 64 characters, no spaces. It becomes PG_DEVICE_ID on the Pi."
                : "Unique, up to 64 characters, no spaces. It becomes PG_DEVICE_ID in the coop’s config.h."
            }
            error={errors.id}
          >
            <Input
              name="deviceId"
              value={deviceId}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              className="pg-mono"
              placeholder={kind === "pi" ? "PI-HOUSE-A…" : "COOP-1…"}
              onChange={(e) => {
                setDeviceId(e.target.value.replace(/\s/g, ""));
                if (errors.id) setErrors({});
              }}
            />
          </Field>
        ) : (
          <>
            <Field label="Name" required error={errors.name}>
              <Input
                name="name"
                value={name}
                maxLength={80}
                autoComplete="off"
                placeholder="House A camera…"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label="Stream URL"
              required
              hint="CameraWebServer streams on port 81: http://<cam-ip>:81/stream"
              error={errors.url}
            >
              <Input
                name="streamUrl"
                type="url"
                inputMode="url"
                value={streamUrl}
                autoComplete="off"
                spellCheck={false}
                className="pg-mono"
                placeholder="http://192.168.1.40:81/stream…"
                onChange={(e) => setStreamUrl(e.target.value)}
              />
            </Field>
          </>
        )}
        <Field
          label="House"
          hint={kind !== "cam" ? "Optional. You can change it later in the table." : "Optional."}
        >
          <Select name="house" value={houseId} onChange={(e) => setHouseId(e.target.value)}>
            <option value="">Unassigned</option>
            {houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </Field>
        {kind !== "cam" && (
          <Field label="Location" hint="Optional. Where it’s mounted.">
            <Input
              name="location"
              value={location}
              autoComplete="off"
              placeholder="North wall, by the fan…"
              onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
        )}
        {errors.form && (
          <p role="alert" className="text-[13px] leading-[18px] text-crit">
            {errors.form}
          </p>
        )}
      </form>
    </Modal>
  );
}

function CreatedModal({ created, onClose }: { created: Created | null; onClose: () => void }) {
  const [copied, setCopied] = useState<"key" | "env" | null>(null);
  const coop = created?.kind === "coop";
  const env = !created
    ? ""
    : coop
      ? `#define PG_API_URL        "${origin()}"\n#define PG_DEVICE_ID      "${created.deviceId}"\n#define PG_DEVICE_API_KEY "${created.apiKey}"\n`
      : `PG_API_URL=${origin()}\nPG_DEVICE_ID=${created.deviceId}\nPG_DEVICE_API_KEY=${created.apiKey}\n`;
  // The Pi can't reach "localhost" on this computer.
  const localOrigin =
    typeof window !== "undefined" && /^(localhost|127\.|\[::1\])/.test(window.location.hostname);

  async function copy(which: "key" | "env") {
    if (!created) return;
    const ok = await copyText(
      which === "key" ? created.apiKey : env,
      which === "key" ? "API key" : "Config",
    );
    if (ok) setCopied(which);
  }

  return (
    <Modal
      open={!!created}
      onOpenChange={(o) => {
        if (!o) {
          setCopied(null);
          onClose();
        }
      }}
      title={coop ? "Coop unit registered" : "Pi registered"}
      description={
        created ? <span className="pg-mono text-ink-2">{created.deviceId}</span> : undefined
      }
      footer={
        <Button
          variant="primary"
          onClick={() => {
            setCopied(null);
            onClose();
          }}
        >
          Done
        </Button>
      }
    >
      {created && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2.5 rounded-md bg-warn-tint px-3 py-2.5 text-[13px] leading-[18px] text-ink">
            <TriangleAlert
              className="mt-px size-4 shrink-0 text-warn"
              aria-hidden
              strokeWidth={1.75}
            />
            <p>
              <span className="font-medium">Store this key now.</span> Anyone with it can post data
              as this {coop ? "coop" : "Pi"}. Managers can reveal it again from the devices table.
            </p>
          </div>

          <div>
            <div className="pg-t-label mb-1.5">API key</div>
            <div className="flex items-center gap-2 rounded-md border border-line-strong bg-surface py-1 pr-1 pl-3">
              <code className="pg-mono min-w-0 flex-1 text-[13px] break-all text-ink">
                {created.apiKey}
              </code>
              <Button
                size="sm"
                icon={copied === "key" ? Check : Copy}
                onClick={() => void copy("key")}
              >
                {copied === "key" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-end justify-between gap-3">
              <div>
                <div className="pg-t-label">{coop ? "config.h" : "agent.env"}</div>
                {coop ? (
                  <p className="pg-t-caption mt-0.5">
                    Paste into <code className="pg-mono">firmware/coop_unit/config.h</code> (copy it
                    from <code className="pg-mono">config.example.h</code>) next to your Wi-Fi name
                    and password.
                  </p>
                ) : (
                  <p className="pg-t-caption mt-0.5">
                    The installer <code className="pg-mono">edge/deploy/install_pi.sh</code> asks
                    for these and writes <code className="pg-mono">/etc/poultrygrid/agent.env</code>
                    .
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={copied === "env" ? Check : Copy}
                onClick={() => void copy("env")}
              >
                {copied === "env" ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre className="pg-mono rounded-md bg-sunken px-3 py-2.5 break-all whitespace-pre-wrap text-[12px] leading-5 text-ink">
              {env}
            </pre>
            {localOrigin && (
              <p className="pg-t-caption mt-1.5">
                <span className="font-medium text-warn">Change PG_API_URL.</span> This page is open
                on {window.location.host}, which the {coop ? "coop" : "Pi"} can’t reach. Use the
                app’s LAN or public address.
              </p>
            )}
          </div>

          {coop ? (
            <div>
              <div className="pg-t-label mb-1.5">Then on the ESP32</div>
              <Steps>
                <li>
                  In the Arduino IDE, install the libraries <Code>DHT sensor library</Code>,{" "}
                  <Code>LiquidCrystal I2C</Code> and <Code>ArduinoJson</Code>, and pick the board{" "}
                  <Code>ESP32 Dev Module</Code>.
                </li>
                <li>
                  Open <Code>firmware/coop_unit/coop_unit.ino</Code>, upload it, and open the serial
                  monitor at 115200 baud. The LCD shows <Code>SITE: ONLINE</Code> once it connects,
                  and the coop shows Online here within about 10 s.
                </li>
                <li>
                  Run it from Automation: switch each zone between Auto and Manual, turn fans and
                  lamps on or off, and set the temperatures.
                </li>
              </Steps>
            </div>
          ) : (
            <div>
              <div className="pg-t-label mb-1.5">Then on the Pi</div>
              <Steps>
                <li>
                  Run <Code>sudo edge/deploy/install_pi.sh</Code> and enter these values. If the
                  agent is already installed, edit <Code>/etc/poultrygrid/agent.env</Code> and run{" "}
                  <Code>sudo systemctl restart poultrygrid-agent</Code>.
                </li>
                <li>
                  Follow the log with <Code>journalctl -u poultrygrid-agent -f</Code>. The Pi shows
                  Online here within about 30 s.
                </li>
              </Steps>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
