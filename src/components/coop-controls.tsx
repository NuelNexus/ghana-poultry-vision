import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CheckCircle2, Droplets, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { listCoops, updateCoopControls, type CoopUnit } from "@/lib/api/controls.functions";
import {
  COOP_ZONES,
  coopControlsSchema,
  type CoopControls,
  type CoopZone,
  type CoopZoneState,
  type ZoneControls,
} from "@/lib/controls";
import {
  Button,
  Card,
  EmptyAction,
  EmptyState,
  ErrorState,
  Field,
  Grid,
  Input,
  RelativeTime,
  Section,
  SegmentedControl,
  SkeletonRows,
  StatusPill,
  Switch,
  formatTemp,
  fromTemp,
  tempUnit,
  toTemp,
  useTempUnit,
} from "@/components/ui-kit";

// Unit 2, the ESP32 coop controller (firmware/coop_unit), on the Automation
// page. Every change is a new settings version; the coop fetches it on its
// next check-in (~10 s) and reports back which version it is running.

const ZONE_LABEL: Record<CoopZone, string> = { layers: "Layers", broilers: "Broilers" };
const MODE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "manual", label: "Manual" },
] as const;

export function CoopControlsSection({ canManage }: { canManage: boolean }) {
  const q = useQuery({ queryKey: ["coops"], queryFn: () => listCoops(), refetchInterval: 5_000 });

  return (
    <Section
      title="Coop · unit 2"
      description="The ESP32 runs fans and lamps in the layers and broilers zones and checks the drinking water. Changes reach it within about 10 seconds."
    >
      {q.isPending ? (
        <SkeletonRows rows={3} cols={4} />
      ) : q.isError || !q.data ? (
        <ErrorState
          title="Couldn’t load the coop"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : q.data.length === 0 ? (
        <EmptyState
          title="No coop unit registered"
          description="Register the ESP32 coop controller under Devices, upload firmware/coop_unit, and its zones show here."
          action={<EmptyAction to="/app/devices">Open devices</EmptyAction>}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {q.data.map((coop) => (
            <CoopPanel
              key={coop.id}
              coop={coop}
              canManage={canManage}
              onSaved={() => void q.refetch()}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function CoopPanel({
  coop,
  canManage,
  onSaved,
}: {
  coop: CoopUnit;
  canManage: boolean;
  onSaved: () => void;
}) {
  const server = coop.controls;
  const serverKey = JSON.stringify(server.config);
  const [draft, setDraft] = useState<CoopControls>(server.config);
  const [saving, setSaving] = useState(false);
  // Follow changes made from another phone or by another person.
  useEffect(() => setDraft(server.config), [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = server.version > 0 && server.applied_version !== server.version;
  const dirty = JSON.stringify(draft) !== serverKey;

  async function save(next: CoopControls) {
    const parsed = coopControlsSchema.safeParse(next);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the values");
      return;
    }
    setSaving(true);
    try {
      const res = await updateCoopControls({ data: { deviceId: coop.id, config: parsed.data } });
      setDraft(parsed.data);
      toast.success(`Sent to ${coop.device_id}`, {
        description: coop.online
          ? `${res.summary}. Applies within about 10 s.`
          : `${res.summary}. The coop is offline and picks this up when it reconnects.`,
      });
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t send the settings");
    } finally {
      setSaving(false);
    }
  }

  const withZone = (zone: CoopZone, patch: Partial<ZoneControls>): CoopControls => ({
    ...draft,
    zones: { ...draft.zones, [zone]: { ...draft.zones[zone], ...patch } },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="pg-mono text-[13px] font-medium text-ink">{coop.device_id}</div>
          <div className="pg-t-caption">
            {coop.house_name ?? "No house assigned"}
            {coop.firmware_version ? ` · ${coop.firmware_version}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SyncStatus coop={coop} pending={pending} />
          {coop.online ? (
            <StatusPill status="ok" pulse>
              Online
            </StatusPill>
          ) : (
            <StatusPill status="offline">
              {coop.last_seen ? "Offline" : "Never connected"}
            </StatusPill>
          )}
        </div>
      </div>

      <Grid cols={2}>
        {COOP_ZONES.map((zone) => (
          <ZoneCard
            key={zone}
            zone={zone}
            coopId={coop.device_id}
            draft={draft.zones[zone]}
            state={coop.latest?.zones?.[zone]}
            readOnly={!canManage || saving}
            onMode={(mode) => void save(withZone(zone, { mode, fan: false, lamp: false }))}
            onSwitch={(what, on) =>
              // Fan and lamp never run together: switching one on switches the other off.
              void save(
                withZone(
                  zone,
                  what === "fan"
                    ? { fan: on, lamp: on ? false : draft.zones[zone].lamp }
                    : { lamp: on, fan: on ? false : draft.zones[zone].fan },
                ),
              )
            }
            onSetpoint={(patch) => setDraft(withZone(zone, patch))}
          />
        ))}
      </Grid>

      <Grid cols={2}>
        <Card title="Drinking water" description="Turbidity sensor in the drinker">
          <Water coop={coop} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Dirty below (V)">
              <Input
                type="number"
                step={0.05}
                inputMode="decimal"
                value={draft.water.bad_v}
                disabled={!canManage || saving}
                onChange={(e) =>
                  setDraft({ ...draft, water: { ...draft.water, bad_v: Number(e.target.value) } })
                }
              />
            </Field>
            <Field label="Clean above (V)">
              <Input
                type="number"
                step={0.05}
                inputMode="decimal"
                value={draft.water.good_v}
                disabled={!canManage || saving}
                onChange={(e) =>
                  setDraft({ ...draft, water: { ...draft.water, good_v: Number(e.target.value) } })
                }
              />
            </Field>
          </div>
          <p className="pg-t-caption mt-2">
            Clear water reads a high voltage. Calibrate with a glass of clean and a glass of dirty
            water.
          </p>
        </Card>
        <Card title="Recent changes">
          {coop.log.length === 0 ? (
            <p className="text-[13px] text-ink-3">No changes from the site yet.</p>
          ) : (
            <ul className="divide-y divide-hairline text-[13px] leading-[18px]">
              {coop.log.map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 text-ink">
                    <span className="pg-mono mr-1.5 text-ink-3">v{l.version}</span>
                    {l.summary}
                  </span>
                  <span className="pg-t-caption shrink-0">
                    {l.user_name ?? "Someone"} · <RelativeTime iso={l.created_at} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Grid>

      {canManage && dirty && (
        <div className="pg-panel sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-2 px-4 py-3">
          <span className="mr-auto text-[13px] text-ink-2">
            Unsent temperature or water changes.
          </span>
          <Button onClick={() => setDraft(server.config)}>Discard</Button>
          <Button variant="primary" loading={saving} onClick={() => void save(draft)}>
            Send to coop
          </Button>
        </div>
      )}
    </div>
  );
}

function SyncStatus({ coop, pending }: { coop: CoopUnit; pending: boolean }) {
  const c = coop.controls;
  if (pending)
    return (
      <span className="pg-t-caption inline-flex items-center gap-1.5" data-tour="coop-sync">
        <Loader2 className="pg-spin size-3.5" aria-hidden />
        {coop.online
          ? `Sending settings v${c.version}…`
          : `Settings v${c.version} wait for the coop to reconnect`}
      </span>
    );
  if (c.version === 0) return <span className="pg-t-caption">Running its built-in settings</span>;
  return (
    <span className="pg-t-caption inline-flex items-center gap-1.5" data-tour="coop-sync">
      <CheckCircle2 className="size-3.5 text-ok" aria-hidden />
      Running settings v{c.version}
      {c.applied_at && (
        <>
          {" · applied "}
          <RelativeTime iso={c.applied_at} />
        </>
      )}
      {c.updated_by_name ? ` · by ${c.updated_by_name}` : ""}
    </span>
  );
}

function ZoneCard({
  zone,
  coopId,
  draft,
  state,
  readOnly,
  onMode,
  onSwitch,
  onSetpoint,
}: {
  zone: CoopZone;
  coopId: string;
  draft: ZoneControls;
  state: CoopZoneState | undefined;
  readOnly: boolean;
  onMode: (m: "auto" | "manual") => void;
  onSwitch: (what: "fan" | "lamp", on: boolean) => void;
  onSetpoint: (patch: Partial<ZoneControls>) => void;
}) {
  useTempUnit(); // re-render when the °C / °F preference changes
  const setpoints: {
    key: "high_temp" | "fan_off_temp" | "low_temp" | "lamp_off_temp";
    label: string;
  }[] = [
    { key: "high_temp", label: "Fan on above" },
    { key: "fan_off_temp", label: "Fan off at" },
    { key: "low_temp", label: "Lamp on below" },
    { key: "lamp_off_temp", label: "Lamp off at" },
  ];

  return (
    <Card
      title={`${ZONE_LABEL[zone]} zone`}
      action={
        state?.safety_tripped ? (
          <StatusPill status="crit">Overheat cut-out</StatusPill>
        ) : state && state.sensor_ok === false ? (
          <StatusPill status="crit">Sensor error</StatusPill>
        ) : (
          <SegmentedControl
            ariaLabel={`${ZONE_LABEL[zone]} zone mode`}
            activation="manual"
            disabled={readOnly}
            value={draft.mode}
            options={MODE_OPTIONS}
            onChange={onMode}
          />
        )
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="pg-t-label">Now</div>
          <div className="pg-num text-[28px] leading-8 font-semibold text-ink">
            {formatTemp(state?.temp)}
          </div>
          <div className="pg-t-caption">
            {state?.humidity != null ? `${state.humidity}% humidity` : "No humidity reading"}
          </div>
        </div>
        <div className="flex gap-2">
          <StatusPill status={state?.fan ? "ok" : "neutral"}>
            Fan {state?.fan ? "on" : "off"}
          </StatusPill>
          <StatusPill status={state?.lamp ? "warn" : "neutral"}>
            Lamp {state?.lamp ? "on" : "off"}
          </StatusPill>
        </div>
      </div>

      {(state?.safety_tripped || state?.sensor_ok === false) && (
        <div className="mt-3">
          <SegmentedControl
            ariaLabel={`${ZONE_LABEL[zone]} zone mode`}
            activation="manual"
            disabled={readOnly}
            value={draft.mode}
            options={MODE_OPTIONS}
            onChange={onMode}
          />
        </div>
      )}

      {draft.mode === "manual" ? (
        <div className="mt-4 flex flex-col gap-3" data-tour="coop-manual">
          {(["fan", "lamp"] as const).map((what) => (
            <label
              key={what}
              className="flex items-center justify-between gap-3 text-[14px] text-ink"
            >
              <span>{what === "fan" ? "Fan" : "Heat lamp"}</span>
              <Switch
                label={`${ZONE_LABEL[zone]} ${what} on ${coopId}`}
                checked={draft[what]}
                disabled={readOnly}
                pending={draft[what] !== !!state?.[what]}
                onCheckedChange={(on) => onSwitch(what, on)}
              />
            </label>
          ))}
          <p className="pg-t-caption">
            Manual: the coop does exactly this. The lamp still switches off by itself if the zone
            overheats or its sensor fails.
          </p>
        </div>
      ) : (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-3">
            {setpoints.map(({ key, label }) => (
              <Field key={key} label={`${label} (${tempUnit()})`}>
                <Input
                  type="number"
                  step={0.5}
                  inputMode="decimal"
                  value={Math.round((toTemp(draft[key]) ?? 0) * 10) / 10}
                  disabled={readOnly}
                  onChange={(e) =>
                    onSetpoint({
                      [key]: Math.round((fromTemp(Number(e.target.value)) ?? 0) * 10) / 10,
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <p className="pg-t-caption mt-2">
            Auto: the coop runs its own thermostat with these temperatures, even when the internet
            is down.
          </p>
        </div>
      )}
    </Card>
  );
}

function Water({ coop }: { coop: CoopUnit }) {
  const l = coop.latest;
  if (!l || l.water_turbidity_v == null)
    return <p className="text-[13px] text-ink-3">No water reading yet.</p>;
  return (
    <div className="flex items-center gap-3">
      <Droplets
        className={`size-7 ${l.water_ok === false ? "text-crit" : "text-ok"}`}
        aria-hidden
        strokeWidth={1.75}
      />
      <div>
        <div className="font-medium text-ink">
          {l.water_ok === false ? "Dirty: change the water" : l.water_ok ? "Clean" : "Sensor error"}
        </div>
        <div className="pg-t-caption">
          {l.water_turbidity_v} V · <RelativeTime iso={l.created_at} />
        </div>
      </div>
    </div>
  );
}
