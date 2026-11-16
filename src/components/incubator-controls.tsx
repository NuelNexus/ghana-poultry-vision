import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { FlaskConical, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  listRelayBoards,
  setIncubatorTargets,
  setRelays,
  type RelayBoard,
} from "@/lib/api/relays.functions";
import {
  DEFAULT_INCUBATOR_TARGETS,
  INCUBATOR_PRESETS,
  INCUBATOR_PRESET_IDS,
  checkReading,
  incubatorTargets,
  type IncubatorPresetId,
  type IncubatorTargets,
  type Reading,
} from "@/lib/presets";
import { DEFAULT_RELAYS, RELAYS, RELAY_INFO, type RelayName, type RelayState } from "@/lib/relays";
import {
  IncubatorDiagram,
  type BrooderView,
  type IncubatorSensorView,
} from "@/components/incubator-diagram";
import { getAiMonitor } from "@/lib/api/farm.functions";
import type { AiSnapshot } from "@/lib/api/types";
import {
  Button,
  Field,
  Input,
  RelativeTime,
  Section,
  Select,
  SkeletonRows,
  StatusPill,
  Switch,
} from "@/components/ui-kit";

// The incubator relay board (firmware/relay_board) on the Automation page: a 2D
// incubator whose controller, fan, lamp and LED strip are each a button. A change
// is sent to the board on its next check-in (about 1.5 s while this page is open);
// until the board reports the new state the part shows a dashed "sending" ring.

const KEY = ["relay-boards"];

// The real board only. The demo unit lives in the Coop section (IncubatorUnitDrawing).
export function IncubatorControlsSection({ canManage }: { canManage: boolean }) {
  const q = useQuery({ queryKey: KEY, queryFn: () => listRelayBoards(), refetchInterval: 2_000 });
  const brooder = useBrooder();

  return (
    <Section
      title="Incubator & brooder · relay board"
      description="Tap a part of the unit or a button on its panel to switch it. The ESP32 relay board picks up the change in a second or two."
    >
      {q.isPending ? (
        <SkeletonRows rows={3} cols={3} />
      ) : q.data?.length ? (
        // A failed refresh keeps the last good data, so the drawing never disappears.
        <div className="flex flex-col gap-10">
          {q.data.map((b) => (
            <BoardPanel key={b.id} board={b} canManage={canManage} brooder={brooder} />
          ))}
        </div>
      ) : (
        <DemoUnitPanel
          reason={
            q.data
              ? "No relay board is registered yet"
              : "The site can’t reach the relay board right now"
          }
          canManage={canManage}
          brooder={brooder}
        />
      )}
    </Section>
  );
}

/** Switch relays on a real board: shows the change at once, rolls back on failure. */
function useBoardSend(board: RelayBoard | undefined, canManage: boolean) {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  async function send(patch: Partial<RelayState>) {
    if (!canManage || !board) return;
    const before = qc.getQueryData<RelayBoard[]>(KEY);
    // Show the change at once; the dashed ring stays until the board confirms it.
    qc.setQueryData<RelayBoard[]>(KEY, (rows) =>
      rows?.map((r) => (r.id === board.id ? { ...r, desired: { ...r.desired, ...patch } } : r)),
    );
    setSending(true);
    try {
      await setRelays({ data: { id: board.id, state: patch } });
      if (!board.online)
        toast.message(`${board.device_id} is offline`, {
          description: "It switches as soon as it reconnects.",
        });
    } catch (e) {
      qc.setQueryData(KEY, before);
      toast.error(e instanceof Error ? e.message : "Couldn’t switch the relay");
    } finally {
      setSending(false);
      void qc.invalidateQueries({ queryKey: KEY });
    }
  }
  return { send, sending };
}

/** Waiting for the board to report a change the site asked for. */
const pendingOf = (board: RelayBoard) => (k: RelayName) =>
  !!board.reported && board.reported[k] !== board.desired[k];

/**
 * The brooding-area unit (the ESP32 with the DHT22 and MQ-135, scored by the AI on the
 * PC, or the old Pi): its latest reading, for the brooder in the drawing. Same query
 * key as the Automation page's table, so it's one request.
 */
function useBrooder(): BrooderView | undefined {
  const ai = useQuery({
    queryKey: ["automation-ai-latest"],
    queryFn: () => getAiMonitor({ data: { hours: 1 } }),
    refetchInterval: 15_000,
  });
  const latest = (ai.data?.latest ?? []) as AiSnapshot[];
  // The newest reading with a temperature, not older than 5 minutes.
  const r = latest
    .filter((x) => x.temperature != null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!r || Date.now() - new Date(r.created_at).getTime() > 5 * 60_000) return undefined;
  return { temp: r.temperature, humidity: r.humidity, status: r.ai_status };
}

function BoardPanel({
  board,
  canManage,
  brooder,
}: {
  board: RelayBoard;
  canManage: boolean;
  brooder: BrooderView | undefined;
}) {
  const { send, sending } = useBoardSend(board, canManage);
  const want = board.desired;
  const pending = pendingOf(board);
  const toggle = (k: RelayName) => void send({ [k]: !want[k] });
  const allOn = RELAYS.every((k) => want[k]);
  const allOff = RELAYS.every((k) => !want[k]);
  // A reading older than a minute is stale (the board checks in every 1.5-15 s).
  const fresh = !!board.reading_at && Date.now() - new Date(board.reading_at).getTime() < 60_000;
  const reading = fresh ? board.reading : null;
  const sensor = board.reading_at ? sensorView(reading, board.targets) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="pg-mono text-[13px] font-medium text-ink">{board.device_id}</div>
          <div className="pg-t-caption">
            {board.house_name ?? "No house assigned"}
            {board.firmware_version ? ` · ${board.firmware_version}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {board.online ? (
            <StatusPill status="ok">Online</StatusPill>
          ) : (
            <StatusPill status="offline">
              {board.last_seen ? "Offline" : "Never connected"}
            </StatusPill>
          )}
          {board.last_seen && (
            <RelativeTime iso={board.last_seen} prefix="Checked in " className="pg-t-caption" />
          )}
        </div>
      </div>

      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <IncubatorDiagram
          state={want}
          pending={pending}
          offline={!board.online}
          disabled={!canManage}
          onToggle={toggle}
          sensor={sensor}
          brooder={brooder}
          display={
            reading?.temp != null ? reading.temp.toFixed(1) : board.reading_at ? "--.-" : undefined
          }
        />

        <div className="flex flex-col gap-3">
          <ClimateCard
            reading={reading}
            readingAt={board.reading_at}
            targets={board.targets}
            history={board.history}
            canManage={canManage}
            onTargets={async (t) => {
              await setIncubatorTargets({ data: { id: board.id, ...t } });
            }}
          />
          <ul className="pg-panel divide-y divide-hairline">
            {RELAYS.map((k) => (
              <li key={k} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-ink">{RELAY_INFO[k].label}</div>
                  <div className="pg-t-caption">
                    {pending(k) ? (
                      <span className="text-info">Sending {want[k] ? "on" : "off"}…</span>
                    ) : (
                      <>
                        {want[k] ? "On" : "Off"} · {RELAY_INFO[k].part} · GPIO {RELAY_INFO[k].pin}
                      </>
                    )}
                  </div>
                </div>
                <Switch
                  checked={want[k]}
                  label={`${RELAY_INFO[k].label}`}
                  pending={pending(k)}
                  disabled={!canManage}
                  onCheckedChange={(v) => void send({ [k]: v })}
                />
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={allOn || sending}
                onClick={() => void send({ incubator: true, fan: true, light: true, strip: true })}
              >
                All on
              </Button>
              <Button
                size="sm"
                disabled={allOff || sending}
                onClick={() =>
                  void send({ incubator: false, fan: false, light: false, strip: false })
                }
              >
                All off
              </Button>
            </div>
          )}
          {!board.online && (
            <p className="pg-t-caption">
              The board is offline. Changes wait here and apply when it reconnects.
            </p>
          )}
          {board.updated_at && (
            <p className="pg-t-caption">
              Last changed <RelativeTime iso={board.updated_at} />
              {board.updated_by_name ? ` by ${board.updated_by_name}` : " on the board itself"}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Demo: a simulated unit in the browser, for when no board is connected.      */
/* One shared state, so every drawing of the demo unit on the page agrees.     */
/* -------------------------------------------------------------------------- */

type Demo = { state: RelayState; temp: number; humidity: number; targets: IncubatorTargets };
const DEMO_START: Demo = {
  state: DEFAULT_RELAYS,
  temp: 37.4,
  humidity: 53,
  targets: DEFAULT_INCUBATOR_TARGETS,
};
let demo: Demo = DEMO_START;
const listeners = new Set<() => void>();
let ticker: number | undefined;

function setDemo(next: Demo) {
  demo = next;
  listeners.forEach((l) => l());
}
function subscribeDemo(l: () => void) {
  listeners.add(l);
  // The controller's reading drifts toward 37.8 °C with the heat on and cools without it.
  if (ticker === undefined)
    ticker = window.setInterval(() => {
      if (document.hidden) return;
      const target = demo.state.incubator ? 37.8 : 29;
      const t = demo.temp + (target - demo.temp) * 0.06 + (Math.random() - 0.5) * 0.06;
      // The fan dries the air a little; a water tray keeps it near 55 %.
      const rh =
        demo.humidity + ((demo.state.fan ? 50 : 57) - demo.humidity) * 0.05 + (Math.random() - 0.5);
      setDemo({ ...demo, temp: Math.round(t * 10) / 10, humidity: Math.round(rh * 10) / 10 });
    }, 1_000);
  return () => {
    listeners.delete(l);
    if (!listeners.size && ticker !== undefined) {
      window.clearInterval(ticker);
      ticker = undefined;
    }
  };
}

function useDemoUnit() {
  const d = useSyncExternalStore(
    subscribeDemo,
    () => demo,
    () => DEMO_START,
  );
  return {
    state: d.state,
    temp: d.temp,
    humidity: d.humidity,
    targets: d.targets,
    setTargets: (targets: IncubatorTargets) => setDemo({ ...demo, targets }),
    set: (patch: Partial<RelayState>) => setDemo({ ...demo, state: { ...demo.state, ...patch } }),
    reset: () => setDemo(DEMO_START),
  };
}

/** The incubator unit as a demo, until a relay board is registered (or reachable). */
function DemoUnitPanel({
  reason,
  canManage,
  brooder,
}: {
  reason: string;
  canManage: boolean;
  brooder: BrooderView | undefined;
}) {
  const { state, temp, humidity, targets, setTargets, set, reset } = useDemoUnit();
  const reading: Reading = { temp, humidity, sensor_ok: true };
  return (
    <div className="flex flex-col gap-4">
      <div className="pg-panel flex flex-wrap items-start gap-3 px-4 py-3">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-info" aria-hidden strokeWidth={1.75} />
        <p className="min-w-0 flex-1 text-[13px] leading-[19px] text-ink-2">
          <span className="font-medium text-ink">Demo unit.</span> {reason}, so this is a simulated
          incubator running in your browser. Nothing is sent to any hardware.
          {canManage ? " Register the board under Devices and the real one shows here." : ""}
        </p>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>
          Reset
        </Button>
      </div>
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <IncubatorDiagram
          state={state}
          pending={() => false}
          offline={false}
          disabled={false}
          display={temp.toFixed(1)}
          sensor={sensorView(reading, targets)}
          brooder={brooder}
          onToggle={(k) => set({ [k]: !state[k] })}
        />
        <div className="flex flex-col gap-3">
          <ClimateCard
            reading={reading}
            readingAt={null}
            targets={targets}
            history={[]}
            canManage
            onTargets={async (t) => setTargets(t)}
          />
          <ul className="pg-panel divide-y divide-hairline">
            {RELAYS.map((k) => (
              <li key={k} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-ink">{RELAY_INFO[k].label}</div>
                  <div className="pg-t-caption">
                    {state[k] ? "On" : "Off"} · {RELAY_INFO[k].part} · GPIO {RELAY_INFO[k].pin}
                  </div>
                </div>
                <Switch
                  checked={state[k]}
                  label={RELAY_INFO[k].label}
                  onCheckedChange={(v) => set({ [k]: v })}
                />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={RELAYS.every((k) => state[k])}
              onClick={() => set({ incubator: true, fan: true, light: true, strip: true })}
            >
              All on
            </Button>
            <Button
              size="sm"
              disabled={RELAYS.every((k) => !state[k])}
              onClick={() => set({ incubator: false, fan: false, light: false, strip: false })}
            >
              All off
            </Button>
          </div>
          <p className="pg-t-caption">
            Incubator {temp.toFixed(1)} °C (simulated): it warms toward 37.8 °C with the heat on.
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Climate: the DHT22 reading against the preset band, and a 6-hour chart.     */
/* -------------------------------------------------------------------------- */

function sensorView(r: Reading | null, t: IncubatorTargets): IncubatorSensorView {
  const c = checkReading(r, t);
  return { temp: r?.temp ?? null, humidity: r?.humidity ?? null, status: c.status };
}

const STATUS_TEXT = {
  ok: { pill: "ok", label: "In range" },
  warn: { pill: "warn", label: "Out of range" },
  crit: { pill: "crit", label: "Danger for the eggs" },
  fault: { pill: "offline", label: "No reading" },
} as const;

function ClimateCard({
  reading,
  readingAt,
  targets,
  history,
  canManage,
  onTargets,
}: {
  reading: Reading | null;
  readingAt: string | null;
  targets: IncubatorTargets;
  history: RelayBoard["history"];
  canManage: boolean;
  onTargets: (t: IncubatorTargets) => Promise<void>;
}) {
  const qc = useQueryClient();
  const check = checkReading(reading, targets);
  const st = STATUS_TEXT[check.status];
  const [custom, setCustom] = useState<IncubatorTargets | null>(null);
  const shown = custom ?? targets;

  async function save(t: IncubatorTargets) {
    try {
      await onTargets(t);
      setCustom(null);
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(
        t.preset === "custom" ? "Custom range saved" : `${INCUBATOR_PRESETS[t.preset].label} set`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t save the range");
    }
  }

  const hint = (what: "temp" | "rh") => {
    const v = what === "temp" ? check.temp : check.rh;
    return v === "low" ? " · too low" : v === "high" ? " · too high" : "";
  };

  return (
    <div className="pg-panel flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[14px] font-medium text-ink">Inside the incubator · DHT22</div>
        <StatusPill status={st.pill}>{st.label}</StatusPill>
      </div>
      <div className="flex flex-wrap gap-6">
        <div>
          <div className="pg-t-label">Temperature</div>
          <div className="pg-num text-[26px] leading-8 font-semibold text-ink">
            {reading?.temp != null ? `${reading.temp.toFixed(1)} °C` : "–"}
          </div>
          <div className="pg-t-caption">
            Target {targets.temp_low}–{targets.temp_high} °C{hint("temp")}
          </div>
        </div>
        <div>
          <div className="pg-t-label">Humidity</div>
          <div className="pg-num text-[26px] leading-8 font-semibold text-ink">
            {reading?.humidity != null ? `${Math.round(reading.humidity)} %` : "–"}
          </div>
          <div className="pg-t-caption">
            Target {targets.rh_low}–{targets.rh_high} %{hint("rh")}
          </div>
        </div>
      </div>
      {check.status === "fault" && (
        <p className="pg-t-caption">
          {readingAt
            ? "The DHT22 isn’t answering. Check its wiring: data to GPIO 14, 3.3 V and GND, with a 10k pull-up if it’s a bare sensor."
            : "No reading yet. Flash relay-board firmware 1.1 or later with the DHT22 on GPIO 14."}
        </p>
      )}
      {readingAt && <RelativeTime iso={readingAt} prefix="Read " className="pg-t-caption" />}
      {history.length > 1 && <Sparkline history={history} targets={targets} />}

      <Field label="Preset" hint="The range the reading is checked against.">
        <Select
          name="incubator-preset"
          value={shown.preset}
          disabled={!canManage}
          onChange={(e) => {
            const id = e.target.value as IncubatorPresetId | "custom";
            if (id === "custom") setCustom({ ...targets, preset: "custom" });
            else void save(incubatorTargets(id));
          }}
        >
          {INCUBATOR_PRESET_IDS.map((id) => (
            <option key={id} value={id}>
              {INCUBATOR_PRESETS[id].label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </Select>
      </Field>
      {custom && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save(custom);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["temp_low", "Temp from (°C)", 0.1],
                ["temp_high", "Temp to (°C)", 0.1],
                ["rh_low", "Humidity from (%)", 1],
                ["rh_high", "Humidity to (%)", 1],
              ] as const
            ).map(([k, label, step]) => (
              <Field key={k} label={label}>
                <Input
                  type="number"
                  step={step}
                  inputMode="decimal"
                  value={custom[k]}
                  onChange={(e) => setCustom({ ...custom, [k]: Number(e.target.value) })}
                />
              </Field>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" type="submit">
              Save range
            </Button>
            <Button size="sm" onClick={() => setCustom(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Temperature over the last hours, with the target band shaded. */
function Sparkline({
  history,
  targets,
}: {
  history: RelayBoard["history"];
  targets: IncubatorTargets;
}) {
  const W = 320;
  const H = 64;
  const temps = history.map((h) => h.temp);
  const lo = Math.min(targets.temp_low - 0.5, ...temps);
  const hi = Math.max(targets.temp_high + 0.5, ...temps);
  const t0 = new Date(history[0].t).getTime();
  const t1 = new Date(history[history.length - 1].t).getTime();
  const x = (t: string) => ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const d = history.map((h, i) => `${i ? "L" : "M"}${x(h.t).toFixed(1)} ${y(h.temp).toFixed(1)}`);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" preserveAspectRatio="none" aria-hidden>
        <rect
          x={0}
          y={y(targets.temp_high)}
          width={W}
          height={y(targets.temp_low) - y(targets.temp_high)}
          fill="var(--pg-ok)"
          opacity={0.12}
        />
        <path d={d.join(" ")} fill="none" stroke="var(--pg-brand)" strokeWidth={1.75} />
      </svg>
      <figcaption className="pg-t-caption">
        Last {Math.max(1, Math.round((t1 - t0) / 3_600_000))} h · shaded = target range
      </figcaption>
    </figure>
  );
}
