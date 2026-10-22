import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Camera as CameraIcon,
  CameraOff,
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
  listCameras,
  listHouses,
  updateCamera,
} from "@/lib/api/farm.functions";
import type { Camera } from "@/lib/api/types";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  GhostTile,
  Input,
  Modal,
  PageHeader,
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

/** An ESP32-CAM that sends no first frame within this long is treated as unreachable. */
const CONNECT_TIMEOUT_MS = 12_000;

function Cameras() {
  const { canManage } = useAuth();
  const [form, setForm] = useState<{ mode: "add" } | { mode: "edit"; cam: Camera } | null>(null);
  const [removing, setRemoving] = useState<Camera | null>(null);
  const [full, setFull] = useState<Camera | null>(null);
  // Each full-size open gets its own URL so the browser opens a fresh connection.
  const [fullN, setFullN] = useState(0);
  const q = useQuery({ queryKey: ["cameras"], queryFn: () => listCameras() });
  const cams = q.data;

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
                canManage={canManage}
                paused={full?.id === c.id}
                onExpand={() => {
                  setFull(c);
                  setFullN((n) => n + 1);
                }}
                onEdit={() => setForm({ mode: "edit", cam: c })}
                onRemove={() => setRemoving(c)}
              />
            ))}
          </div>
          <ViewingNotes />
        </>
      )}

      <CameraFormModal
        state={form}
        onClose={() => setForm(null)}
        onSaved={() => {
          setForm(null);
          void q.refetch();
        }}
      />

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
  canManage,
  paused,
  onExpand,
  onEdit,
  onRemove,
}: {
  cam: Camera;
  canManage: boolean;
  paused: boolean;
  onExpand: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const url = cam.stream_url;
  const blocked = !!url && isMixedContent(url);
  const [state, setState] = useState<StreamState>(
    !url ? "none" : blocked ? "blocked" : "connecting",
  );
  const [attempt, setAttempt] = useState(0);
  const urls = url ? cameraUrls(url) : null;
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
            {shown === "none" && (
              <TileNote icon={VideoOff} title="No stream URL">
                {canManage
                  ? "Edit the camera and add http://<cam-ip>:81/stream."
                  : "Ask a farm manager to add the camera’s stream URL."}
              </TileNote>
            )}
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
          </p>
        </div>
        <StatusPill status={pill.status} pulse={shown === "live"}>
          {pill.label}
        </StatusPill>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-2.5">
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
  onSaved: () => void;
}) {
  const editing = state?.mode === "edit" ? state.cam : null;
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
    setErrors({});
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const u = url.trim();
    if (!name.trim()) next.name = "Enter a name.";
    if (!u) next.url = "Enter the camera’s stream URL.";
    else if (!/^https?:\/\/\S+$/i.test(u))
      next.url = "Use a full URL starting with http://, for example http://192.168.1.40:81/stream";
    setErrors(next);
    if (next.name || next.url) return;
    setBusy(true);
    try {
      if (editing) {
        await updateCamera({
          data: { id: editing.id, name: name.trim(), streamUrl: u, houseId: houseId || null },
        });
        toast.success(`${name.trim()} saved`);
      } else {
        await createCamera({
          data: { name: name.trim(), streamUrl: u, houseId: houseId || undefined },
        });
        toast.success(`${name.trim()} added`);
      }
      onSaved();
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
      description="ESP32-CAM running the standard CameraWebServer firmware."
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
