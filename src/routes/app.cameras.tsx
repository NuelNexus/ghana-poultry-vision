import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bug,
  Camera as CameraIcon,
  CameraOff,
  Check,
  Copy,
  Eye,
  Wifi,
  Lock,
  Maximize2,
  Pencil,
  Plus,
  RotateCw,
  ShieldAlert,
  Trash2,
  VideoOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createCamera,
  deleteCamera,
  linkCameraFirmware,
  listCameras,
  listHouses,
  updateCamera,
} from "@/lib/api/farm.functions";
import type { Camera } from "@/lib/api/types";
import { getCameraVision, type CameraVision, type VisionEvent } from "@/lib/api/vision.functions";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  GhostTile,
  Input,
  Modal,
  PageHeader,
  RelativeTime,
  Section,
  SegmentedControl,
  Select,
  Skeleton,
  StatusPill,
  buttonClass,
  type Status,
} from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";
import { cameraUrls, isMixedContent, withBust } from "@/lib/esp32cam";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/cameras")({ component: Cameras });

/** What this browser can actually see of the stream. Nothing is stored server side. */
type StreamState = "none" | "blocked" | "connecting" | "live" | "error" | "paused";

const STATE_PILL: Record<StreamState, { status: Status; label: string }> = {
  none: { status: "offline", label: "No stream URL" },
  blocked: { status: "warn", label: "Blocked on https" },
  connecting: { status: "neutral", label: "Connecting…" },
  live: { status: "ok", label: "Streaming" },
  error: { status: "offline", label: "Unreachable" },
  paused: { status: "neutral", label: "Open full size" },
};

/** firmware/esp32cam checks in every 60 s; three missed check-ins = offline. */
const CHECKIN_OFFLINE_MS = 3 * 60_000;
const checkedInRecently = (c: Camera) =>
  !!c.last_seen && Date.now() - new Date(c.last_seen).getTime() < CHECKIN_OFFLINE_MS;

type CamKeys = { name: string; deviceId: string; apiKey: string };

/** An ESP32-CAM that sends no first frame within this long is treated as unreachable. */
const CONNECT_TIMEOUT_MS = 12_000;

function Cameras() {
  const { canManage } = useAuth();
  const [form, setForm] = useState<{ mode: "add" } | { mode: "edit"; cam: Camera } | null>(null);
  const [removing, setRemoving] = useState<Camera | null>(null);
  // Device ID and key for a camera that reports its own address (firmware/esp32cam).
  const [keys, setKeys] = useState<CamKeys | null>(null);
  async function linkFirmware(cam: Camera) {
    try {
      const r = await linkCameraFirmware({ data: { id: cam.id } });
      setKeys({ name: cam.name, ...r });
      void q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t set up the auto address");
    }
  }
  const [full, setFull] = useState<Camera | null>(null);
  // Each full-size open gets its own URL so the browser opens a fresh connection.
  const [fullN, setFullN] = useState(0);
  const q = useQuery({ queryKey: ["cameras"], queryFn: () => listCameras() });
  const cams = q.data;
  // What the YOLO11n worker (edge/vision.py) last saw on each camera.
  const vision = useQuery({
    queryKey: ["camera-vision"],
    queryFn: () => getCameraVision(),
    refetchInterval: 10_000,
    enabled: !!cams?.length,
  });
  const visionBy = new Map((vision.data?.latest ?? []).map((v) => [v.camera_id, v]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cameras"
        meta={
          cams && cams.length > 0 ? (
            <span>
              {cams.length === 1 ? "1 camera" : `${cams.length} cameras`} · ESP32-CAM, viewed
              directly from this browser
            </span>
          ) : undefined
        }
        className="mb-0 md:mb-0"
      >
        {canManage ? (
          cams?.length === 0 ? null : (
            <Button icon={Plus} onClick={() => setForm({ mode: "add" })}>
              Add camera
            </Button>
          )
        ) : cams?.length === 0 ? null : (
          <p className="pg-t-caption inline-flex items-center gap-1.5">
            <Lock className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
            Managers can add and edit cameras.
          </p>
        )}
      </PageHeader>

      {q.isPending ? (
        <div className="pg-panel overflow-hidden" role="status" aria-label="Loading cameras">
          <Skeleton className="block aspect-video h-auto max-h-[60vh] w-full rounded-none" />
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      ) : q.isError || !cams ? (
        <ErrorState
          title="Couldn’t load cameras"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : cams.length === 0 ? (
        <EmptyState
          title="No camera added"
          description={
            <>
              Add the ESP32-CAM by its MJPEG stream URL. With the standard CameraWebServer firmware
              that’s <span className="pg-mono">http://&lt;cam-ip&gt;:81/stream</span>.
            </>
          }
          action={
            canManage ? (
              <Button icon={Plus} onClick={() => setForm({ mode: "add" })}>
                Add camera
              </Button>
            ) : undefined
          }
          note={!canManage ? "Ask a farm manager to add the camera." : undefined}
          preview={<GhostTile label="ESP32-CAM · House A" />}
        />
      ) : (
        <>
          <div
            className={cn(
              "grid grid-cols-1 gap-4",
              cams.length > 1 && "lg:grid-cols-2",
              cams.length === 1 && "max-w-[1040px]",
            )}
          >
            {cams.map((c) => (
              <CameraTile
                key={c.id}
                cam={c}
                vision={visionBy.get(c.id)}
                canManage={canManage}
                paused={full?.id === c.id}
                onExpand={() => {
                  setFull(c);
                  setFullN((n) => n + 1);
                }}
                onEdit={() => setForm({ mode: "edit", cam: c })}
                onAutoAddress={() => void linkFirmware(c)}
                onRemove={() => setRemoving(c)}
              />
            ))}
          </div>
          <VisionEvents
            events={vision.data?.events ?? []}
            cams={cams}
            anyVision={visionBy.size > 0}
          />
          <ViewingNotes />
        </>
      )}

      <CameraFormModal
        state={form}
        onClose={() => setForm(null)}
        onSaved={(k) => {
          setForm(null);
          if (k) setKeys(k);
          void q.refetch();
        }}
      />

      <CamKeysModal keys={keys} onClose={() => setKeys(null)} />

      <RemoveModal
        cam={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setRemoving(null);
          void q.refetch();
        }}
      />

      <Modal
        open={!!full}
        onOpenChange={(o) => !o && setFull(null)}
        title={full?.name ?? "Camera"}
        description={
          full?.stream_url ? <span className="pg-mono">{full.stream_url}</span> : undefined
        }
        className="md:w-[min(1120px,calc(100vw-64px))]"
      >
        {full?.stream_url && (
          <div className="overflow-hidden rounded-md bg-ink">
            <img
              src={withBust(full.stream_url, 100_000 + fullN)}
              alt={`Live view from ${full.name}`}
              className="mx-auto block max-h-[calc(100dvh-180px)] w-full object-contain"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

function ViewingNotes() {
  return (
    <ul className="pg-t-caption flex max-w-[80ch] list-disc flex-col gap-1 pl-4">
      <li>
        Your browser opens the camera directly, so it only works from a phone or laptop on the farm
        Wi-Fi (or over a VPN to it). The app’s server never sees the video.
      </li>
      <li>
        The ESP32-CAM serves one stream at a time. If it won’t connect, close it on other devices
        and tap Reconnect. Full size pauses the small view so the two don’t compete.
      </li>
      <li>
        The firmware only speaks http. If this console is open over https, browsers block the
        stream; open the stream link directly instead.
      </li>
    </ul>
  );
}

function CameraTile({
  cam,
  vision,
  canManage,
  paused,
  onExpand,
  onEdit,
  onAutoAddress,
  onRemove,
}: {
  cam: Camera;
  vision: CameraVision | undefined;
  canManage: boolean;
  paused: boolean;
  onExpand: () => void;
  onEdit: () => void;
  onAutoAddress: () => void;
  onRemove: () => void;
}) {
  const url = cam.stream_url;
  const auto = !!cam.device_code;
  const blocked = !!url && isMixedContent(url);
  const [state, setState] = useState<StreamState>(
    !url ? "none" : blocked ? "blocked" : "connecting",
  );
  const [attempt, setAttempt] = useState(0);
  const urls = url ? cameraUrls(url) : null;
  // The annotated frame from the vision worker: also works on https, where the
  // camera's own http stream is blocked.
  const [aiView, setAiView] = useState(false);
  const showAi = aiView && !!vision?.frame;
  const shown: StreamState = paused && url && !blocked ? "paused" : state;
  const pill = STATE_PILL[shown];

  // Reset when the URL changes (after an edit).
  const [lastUrl, setLastUrl] = useState(url);
  if (url !== lastUrl) {
    setLastUrl(url);
    setState(!url ? "none" : blocked ? "blocked" : "connecting");
  }

  // An MJPEG stream that never sends a frame should not spin forever.
  useEffect(() => {
    if (state !== "connecting" || paused) return;
    const t = setTimeout(
      () => setState((s) => (s === "connecting" ? "error" : s)),
      CONNECT_TIMEOUT_MS,
    );
    return () => clearTimeout(t);
  }, [state, attempt, paused]);

  // After full size closes, open a fresh connection.
  const [wasPaused, setWasPaused] = useState(paused);
  if (paused !== wasPaused) {
    setWasPaused(paused);
    if (!paused && url && !blocked) {
      setState("connecting");
      setAttempt((a) => a + 1);
    }
  }

  function reconnect() {
    if (!url || blocked) return;
    setState("connecting");
    setAttempt((a) => a + 1);
  }

  return (
    <article className="pg-panel flex min-w-0 flex-col overflow-hidden" aria-label={cam.name}>
      <div className="relative aspect-video bg-sunken">
        {showAi && (
          <img
            src={vision!.frame!}
            alt={`What the AI saw on ${cam.name}`}
            className="absolute inset-0 z-[1] h-full w-full bg-sunken object-contain"
          />
        )}
        {url && !blocked && !paused && state !== "error" && (
          <img
            key={attempt}
            src={withBust(url, attempt)}
            alt={`Live view from ${cam.name}`}
            className={cn("h-full w-full object-contain", state !== "live" && "invisible")}
            onLoad={() => setState("live")}
            onError={() => setState("error")}
          />
        )}
        {shown !== "live" && (
          <div className="absolute inset-0 flex flex-col items-start justify-end gap-2 p-4">
            {shown === "connecting" && (
              <Skeleton className="absolute inset-0 h-full rounded-none" />
            )}
            {shown === "none" &&
              (auto ? (
                <TileNote icon={Wifi} title="Waiting for the camera">
                  It hasn’t checked in yet. Flash firmware/esp32cam with this camera’s secrets.h and
                  power it on; its address appears here within a minute.
                </TileNote>
              ) : (
                <TileNote icon={VideoOff} title="No stream URL">
                  {canManage
                    ? "Edit the camera and add http://<cam-ip>:81/stream."
                    : "Ask a farm manager to add the camera’s stream URL."}
                </TileNote>
              ))}
            {shown === "paused" && (
              <TileNote icon={Maximize2} title="Showing full size">
                The small view is paused while full size is open.
              </TileNote>
            )}
            {shown === "blocked" && (
              <TileNote icon={ShieldAlert} title="Blocked by the browser">
                This page is on https and the ESP32-CAM only serves http, so the browser won’t load
                it here. Open the stream link from a device on the farm Wi-Fi.
              </TileNote>
            )}
            {shown === "error" && (
              <TileNote icon={CameraOff} title="Can’t reach the camera">
                Check it has power and Wi-Fi, that this device is on the farm network, and that no
                other device is watching it.
              </TileNote>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="pg-t-h3 truncate">{cam.name}</h2>
          <p className="pg-t-caption truncate">
            {cam.house_name ? `${cam.house_name} · ` : ""}
            {urls ? <span className="pg-mono">{urls.host}</span> : "No stream URL"}
            {auto && (
              <>
                {" · "}
                <span title="This camera reports its own IP every minute, so a new address from the router is picked up by itself.">
                  Auto address
                  {cam.last_seen ? (
                    <>
                      {checkedInRecently(cam) ? "" : " · offline, last seen "}
                      {!checkedInRecently(cam) && <RelativeTime iso={cam.last_seen} />}
                    </>
                  ) : (
                    " · not checked in yet"
                  )}
                </span>
              </>
            )}
          </p>
        </div>
        <StatusPill status={pill.status} pulse={shown === "live"}>
          {pill.label}
        </StatusPill>
      </div>
      <VisionStrip vision={vision} />
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-2.5">
        {vision?.frame && (
          <Button
            size="sm"
            variant={aiView ? "primary" : "secondary"}
            icon={Eye}
            aria-pressed={aiView}
            onClick={() => setAiView((v) => !v)}
          >
            AI view
          </Button>
        )}
        <Button
          size="sm"
          icon={RotateCw}
          onClick={reconnect}
          disabled={!url || blocked || paused || shown === "connecting"}
        >
          Reconnect
        </Button>
        {urls?.snapshot && (
          <a
            href={urls.snapshot}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({ size: "sm", variant: "ghost" })}
            aria-label={`Open a snapshot from ${cam.name} in a new tab`}
          >
            <CameraIcon className="size-4" aria-hidden strokeWidth={1.75} />
            Snapshot
          </a>
        )}
        {url && blocked && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({ size: "sm", variant: "ghost" })}
          >
            Open stream
          </a>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={Maximize2}
          onClick={onExpand}
          disabled={shown !== "live"}
        >
          Full size
        </Button>
        {canManage && (
          <span className="ml-auto flex items-center gap-1">
            {!auto && (
              <Button
                size="sm"
                variant="ghost"
                icon={Wifi}
                onClick={onAutoAddress}
                title="Flash firmware/esp32cam on this camera so it reports its own address"
              >
                Auto address
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon={Pencil}
              aria-label={`Edit ${cam.name}`}
              onClick={onEdit}
            />
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon={Trash2}
              aria-label={`Remove ${cam.name}`}
              onClick={onRemove}
            />
          </span>
        )}
      </div>
    </article>
  );
}

/** The vision worker counts older than this are shown as stale. */
const VISION_STALE_MS = 3 * 60_000;

function VisionStrip({ vision }: { vision: CameraVision | undefined }) {
  if (!vision)
    return (
      <p className="pg-t-caption border-t border-hairline px-4 py-2.5">
        AI vision: not running for this camera. Start{" "}
        <span className="pg-mono">edge/vision.py</span> on the Pi or a PC on the farm network.
      </p>
    );
  const stale = Date.now() - new Date(vision.analysed_at).getTime() > VISION_STALE_MS;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline px-4 py-2.5 text-[13px]">
      <span className="text-ink">
        <span className="pg-num font-semibold">{vision.birds}</span> birds
      </span>
      <span className={vision.inactive ? "text-crit" : "text-ink-2"}>
        <span className="pg-num font-semibold">{vision.inactive}</span> inactive
      </span>
      <span className="text-ink-2">
        Activity{" "}
        <span className="pg-num font-semibold text-ink">
          {vision.activity == null ? "–" : `${Math.round(vision.activity * 100)}%`}
        </span>
      </span>
      {vision.pests.length > 0 ? (
        <StatusPill status="crit">
          {[...new Set(vision.pests.map((p) => p.label))].join(", ")}
        </StatusPill>
      ) : (
        <StatusPill status="ok">No pests</StatusPill>
      )}
      <span className="pg-t-caption ml-auto">
        {stale ? "Stale · " : ""}
        <RelativeTime iso={vision.analysed_at} />
        {vision.worker ? ` · ${vision.worker}` : ""}
      </span>
    </div>
  );
}

const EVENT_TEXT: Record<VisionEvent["kind"], string> = {
  pest: "Pest or predator",
  inactive: "Inactive birds",
  low_activity: "Low flock activity",
};

function VisionEvents({
  events,
  cams,
  anyVision,
}: {
  events: VisionEvent[];
  cams: Camera[];
  anyVision: boolean;
}) {
  const name = new Map(cams.map((c) => [c.id, c.name]));
  return (
    <Section
      title="AI vision · last 24 hours"
      description="YOLO11n watches each camera for pests and predators, and for birds that stop moving."
    >
      {events.length === 0 ? (
        <p className="pg-t-caption">
          {anyVision
            ? "Nothing seen. Birds are moving and no pests have shown up."
            : "No vision worker has reported yet. See edge/README.md, “Camera vision”, to start it on the Pi or your PC."}
        </p>
      ) : (
        <ul className="pg-panel divide-y divide-hairline">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-4 py-3">
              {e.kind === "pest" ? (
                <Bug className="mt-0.5 size-4 shrink-0 text-crit" aria-hidden strokeWidth={1.75} />
              ) : (
                <ShieldAlert
                  className="mt-0.5 size-4 shrink-0 text-warn"
                  aria-hidden
                  strokeWidth={1.75}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-ink">
                  {e.kind === "pest"
                    ? e.label.charAt(0).toUpperCase() + e.label.slice(1)
                    : EVENT_TEXT[e.kind]}
                  <span className="font-normal text-ink-2">
                    {" "}
                    · {name.get(e.camera_id) ?? "Camera"}
                  </span>
                </div>
                {e.detail && <p className="pg-t-caption">{e.detail}</p>}
              </div>
              <RelativeTime iso={e.created_at} className="pg-t-caption shrink-0" />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TileNote({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof VideoOff;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative max-w-[44ch]">
      <div className="flex items-center gap-1.5 text-[13px] leading-[18px] font-medium text-ink">
        <Icon className="size-4 text-ink-3" aria-hidden strokeWidth={1.75} />
        {title}
      </div>
      <p className="mt-0.5 text-[12px] leading-4 text-ink-2">{children}</p>
    </div>
  );
}

function CameraFormModal({
  state,
  onClose,
  onSaved,
}: {
  state: { mode: "add" } | { mode: "edit"; cam: Camera } | null;
  onClose: () => void;
  /** With the camera's device ID and key when it was set to report its own address. */
  onSaved: (keys?: CamKeys) => void;
}) {
  const editing = state?.mode === "edit" ? state.cam : null;
  const wasAuto = !!editing?.device_code;
  // "auto": firmware/esp32cam reports its IP; "fixed": a typed stream URL (stock firmware).
  const [addr, setAddr] = useState<"auto" | "fixed">("auto");
  const houses = useQuery({
    queryKey: ["houses"],
    queryFn: () => listHouses(),
    enabled: !!state,
  });
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [houseId, setHouseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; url?: string; form?: string }>({});

  // Load the camera's values each time the modal opens.
  const [opened, setOpened] = useState<typeof state>(null);
  if (state !== opened) {
    setOpened(state);
    setName(editing?.name ?? "");
    setUrl(editing?.stream_url ?? "");
    setHouseId(editing?.house_id ?? "");
    setAddr(!editing || editing.device_code ? "auto" : "fixed");
    setErrors({});
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const u = url.trim();
    if (!name.trim()) next.name = "Enter a name.";
    if (addr === "auto") {
      /* the camera fills in its own address */
    } else if (!u) next.url = "Enter the camera’s stream URL.";
    else if (!/^https?:\/\/\S+$/i.test(u))
      next.url = "Use a full URL starting with http://, for example http://192.168.1.40:81/stream";
    setErrors(next);
    if (next.name || next.url) return;
    setBusy(true);
    try {
      const streamUrl = addr === "auto" ? editing?.stream_url || null : u;
      let id: string;
      if (editing) {
        await updateCamera({
          data: { id: editing.id, name: name.trim(), streamUrl, houseId: houseId || null },
        });
        id = editing.id;
        toast.success(`${name.trim()} saved`);
      } else {
        const r = await createCamera({
          data: {
            name: name.trim(),
            streamUrl: streamUrl || undefined,
            houseId: houseId || undefined,
          },
        });
        id = r.id;
        toast.success(`${name.trim()} added`);
      }
      // Newly set to auto: give it a device ID and key for its firmware.
      if (addr === "auto" && !wasAuto) {
        const k = await linkCameraFirmware({ data: { id } });
        onSaved({ name: name.trim(), ...k });
      } else onSaved();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : "Couldn’t save the camera" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!state}
      onOpenChange={(o) => !o && onClose()}
      title={editing ? "Edit camera" : "Add camera"}
      description="An ESP32-CAM on the farm Wi-Fi."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="camera-form" loading={busy}>
            {editing ? "Save camera" : "Add camera"}
          </Button>
        </>
      }
    >
      <form id="camera-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
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
          label="Address"
          hint={
            addr === "auto"
              ? "Flash firmware/esp32cam: the camera tells the site its IP every minute, so it keeps working when the router gives it a new address."
              : "Stock CameraWebServer firmware. If the router changes the camera’s IP, edit this, or reserve the IP in the router."
          }
        >
          {wasAuto ? (
            <p className="text-[13px] leading-[18px] text-ink-2">
              Updates itself
              {editing?.stream_url ? (
                <>
                  {" · now "}
                  <span className="pg-mono">{editing.stream_url}</span>
                </>
              ) : (
                " · waiting for the first check-in"
              )}
            </p>
          ) : (
            <SegmentedControl
              ariaLabel="Camera address"
              value={addr}
              onChange={setAddr}
              options={[
                { value: "auto", label: "Updates itself" },
                { value: "fixed", label: "Fixed URL" },
              ]}
            />
          )}
        </Field>
        {addr === "fixed" && (
          <Field
            label="Stream URL"
            required
            hint="Port 81, path /stream. The IP is printed on the camera’s serial monitor at boot."
            error={errors.url}
          >
            <Input
              name="streamUrl"
              type="url"
              inputMode="url"
              value={url}
              autoComplete="off"
              spellCheck={false}
              className="pg-mono"
              placeholder="http://192.168.1.40:81/stream…"
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
        )}
        <Field label="House" hint="Optional.">
          <Select name="house" value={houseId} onChange={(e) => setHouseId(e.target.value)}>
            <option value="">Unassigned</option>
            {houses.data?.houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </Field>
        {errors.form && (
          <p role="alert" className="text-[13px] leading-[18px] text-crit">
            {errors.form}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** The three lines for firmware/esp32cam/secrets.h. */
function CamKeysModal({ keys, onClose }: { keys: CamKeys | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const site = typeof window === "undefined" ? "" : window.location.origin;
  const local = /^https?:\/\/(localhost|127\.|\[::1\])/.test(site);
  const text = keys
    ? `#define PG_API_URL        "${site}"\n#define PG_DEVICE_ID      "${keys.deviceId}"\n#define PG_DEVICE_API_KEY "${keys.apiKey}"\n`
    : "";
  return (
    <Modal
      open={!!keys}
      onOpenChange={(o) => {
        if (!o) {
          setCopied(false);
          onClose();
        }
      }}
      title={`${keys?.name ?? "Camera"}: auto address`}
      description="Shown once. Run Auto address again for a new key."
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-[19px] text-ink-2">
          Copy <span className="pg-mono">firmware/esp32cam/secrets.example.h</span> to{" "}
          <span className="pg-mono">secrets.h</span>, put in your Wi-Fi name and password and these
          three lines, then upload <span className="pg-mono">esp32cam.ino</span> to the camera.
          Within a minute of joining the Wi-Fi it shows up here, and it keeps doing so whatever IP
          the router gives it.
        </p>
        <div className="flex items-end justify-between gap-3">
          <div className="pg-t-label">secrets.h</div>
          <Button
            size="sm"
            variant="ghost"
            icon={copied ? Check : Copy}
            onClick={() =>
              void navigator.clipboard.writeText(text).then(
                () => setCopied(true),
                () => toast.error("Couldn’t copy. Select the text instead."),
              )
            }
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre className="pg-mono rounded-md bg-sunken px-3 py-2.5 text-[12px] leading-5 break-all whitespace-pre-wrap text-ink">
          {text}
        </pre>
        {local && (
          <p className="pg-t-caption">
            <span className="font-medium text-warn">Change PG_API_URL.</span> This page is open on{" "}
            {window.location.host}, which the camera can’t reach. Use the live site’s address, e.g.
            https://ghana-poultry-vision.vercel.app.
          </p>
        )}
      </div>
    </Modal>
  );
}

function RemoveModal({
  cam,
  onClose,
  onRemoved,
}: {
  cam: Camera | null;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!cam) return;
    setBusy(true);
    try {
      await deleteCamera({ data: { id: cam.id } });
      toast.success(`${cam.name} removed`);
      onRemoved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t remove the camera");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={!!cam}
      onOpenChange={(o) => !o && onClose()}
      title={`Remove ${cam?.name ?? "camera"}?`}
      description="It disappears from this page for everyone. The camera itself keeps running and can be added again."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={() => void remove()}>
            Remove camera
          </Button>
        </>
      }
    >
      {cam?.stream_url && <p className="pg-mono text-[13px] text-ink-2">{cam.stream_url}</p>}
    </Modal>
  );
}
