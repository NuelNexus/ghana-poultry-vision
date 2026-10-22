import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createHatchery, listFarms, listHatcheries, recordHatch } from "@/lib/api/farm.functions";
import { useAuth } from "@/lib/auth";
import type { Hatchery as Batch } from "@/lib/api/types";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  Metric,
  MetricGrid,
  Modal,
  PageHeader,
  QueryState,
  Select,
  SkeletonMetrics,
  SkeletonRows,
  StatusPill,
  formatDate,
  formatNumber,
  formatTemp,
  fromTemp,
  tempUnit,
  toTemp,
  useDisplayPrefs,
  type Column,
  type Status,
} from "@/components/ui-kit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/hatchery")({ component: Hatchery });

const DAY = 86_400_000;
const NBSP = String.fromCharCode(160);
/** Chicken incubation: 21 days. Candle on day 7 and 14, lockdown from day 18. */
const TOTAL = 21;
const MILESTONES = [
  { day: 7, label: "Candle" },
  { day: 14, label: "Candle" },
  { day: 18, label: "Lockdown" },
] as const;
/**
 * Standard guidance for chicken eggs, shown as advice only. Nothing measures the
 * incubator: the settings in each batch are what the farmer typed in.
 */
const TARGET = { temp: 37.5, rh: [55, 60], rhLockdown: [65, 70] } as const;

type Stage = { label: string; status: Status };

function incubationDay(b: Batch, now = Date.now()) {
  if (!b.started_at) return null;
  return Math.floor((now - new Date(b.started_at).getTime()) / DAY) + 1;
}

function stage(b: Batch, day: number | null): Stage {
  if (day == null) return { label: "Not started", status: "neutral" };
  if (b.hatched_count != null) return { label: "Hatched", status: "ok" };
  if (day > TOTAL) return { label: "Overdue", status: "warn" };
  if (day >= 18) return { label: "Lockdown", status: "info" };
  return { label: "Incubating", status: "brand" };
}

function nextStep(day: number | null) {
  if (day == null) return null;
  const m = MILESTONES.find((x) => x.day >= day);
  if (m) {
    const d = m.day - day;
    return d === 0 ? `${m.label} today` : `${m.label} in ${d}${NBSP}d`;
  }
  const d = TOTAL - day;
  return d > 0 ? `Hatch in ${d}${NBSP}d` : d === 0 ? "Hatch due today" : null;
}

function Hatchery() {
  // Re-render when the temperature unit preference changes.
  useDisplayPrefs();
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState<Batch | null>(null);
  const { canManage } = useAuth();
  const q = useQuery({ queryKey: ["hatcheries"], queryFn: () => listHatcheries() });
  const count = q.data?.length ?? 0;

  const startButton = canManage ? (
    <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
      Start batch
    </Button>
  ) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="mb-2 md:mb-2"
        title="Hatchery"
        meta={
          count > 0 ? (
            <>
              <span>
                {count} {count === 1 ? "batch" : "batches"}
              </span>
              <span>
                Recommended {formatTemp(TARGET.temp)} · {TARGET.rh[0]}–{TARGET.rh[1]}% RH,{" "}
                {TARGET.rhLockdown[0]}–{TARGET.rhLockdown[1]}% in lockdown
              </span>
              <span>Records are entered by hand; no sensor is in the incubator</span>
              {!canManage && <span>Starting batches needs a manager role</span>}
            </>
          ) : undefined
        }
      >
        {count > 0 && startButton}
      </PageHeader>

      <QueryState
        query={q}
        loading={
          <div className="flex flex-col gap-6" aria-busy>
            <SkeletonMetrics count={4} cols={4} />
            <SkeletonRows rows={3} cols={5} />
          </div>
        }
        errorTitle="Couldn’t load hatchery batches"
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            title="No incubation batches"
            description={`A hand-kept record of each incubator batch: its day of ${TOTAL}, the next candling or lockdown step, the expected hatch date and, once counted, how many chicks hatched.`}
            action={startButton}
            note={
              canManage
                ? undefined
                : "Ask a farm manager to start a batch. Your role can follow progress once it’s running."
            }
          />
        }
      >
        {(batches) => (
          <>
            <Summary batches={batches} />
            <DataTable
              caption="Incubation batches"
              rows={batches}
              rowKey={(b) => b.id}
              columns={columns(canManage, setRecording)}
            />
          </>
        )}
      </QueryState>

      <StartBatch open={open} onOpenChange={setOpen} />
      <RecordHatch batch={recording} onClose={() => setRecording(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function Summary({ batches }: { batches: Batch[] }) {
  const active = batches.filter((b) => {
    const d = incubationDay(b);
    return d != null && b.hatched_count == null;
  });
  const eggs = active.reduce((s, b) => s + (b.egg_count ?? 0), 0);
  const soon = active.filter((b) => (incubationDay(b) ?? 0) >= 18);
  const finished = batches.filter((b) => b.hatched_count != null);
  const hatched = finished.reduce((s, b) => s + (b.hatched_count ?? 0), 0);
  const set = finished.reduce((s, b) => s + (b.egg_count ?? 0), 0);

  return (
    <MetricGrid cols={4}>
      <Metric label="Active batches" value={active.length} sub={`${batches.length} in total`} />
      <Metric label="Eggs in incubation" value={formatNumber(eggs, { maximumFractionDigits: 0 })} />
      <Metric
        label="In lockdown"
        value={soon.length}
        sub={soon.length ? soon.map((b) => b.name).join(", ") : "None hatching in the next 3 days"}
      />
      <Metric
        label="Hatch rate"
        value={set ? Math.round((hatched / set) * 100) : null}
        unit="%"
        sub={
          set
            ? `${formatNumber(hatched, { maximumFractionDigits: 0 })} chicks from ${formatNumber(set, { maximumFractionDigits: 0 })} eggs`
            : "Shown after the first hatch"
        }
      />
    </MetricGrid>
  );
}

/* ------------------------------------------------------------------------ */

/** 21-day track with candling (7, 14) and lockdown (18) ticks. */
function IncubationTrack({ day, done }: { day: number; done?: boolean }) {
  const pct = (Math.min(Math.max(day, 0), TOTAL) / TOTAL) * 100;
  return (
    <div className="relative mt-1.5 h-1.5 w-full max-w-[220px]" aria-hidden>
      <div className="absolute inset-0 overflow-hidden rounded-full bg-sunken">
        <div
          className={cn("h-full", done ? "bg-ok" : day >= 18 ? "bg-info" : "bg-brand")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {MILESTONES.map((m) => (
        <span
          key={m.day}
          className="absolute -top-0.5 h-2.5 w-px bg-ink-3/60"
          style={{ left: `${(m.day / TOTAL) * 100}%` }}
        />
      ))}
    </div>
  );
}

/** The incubator setting the farmer entered, flagged when outside the guidance. */
function Setting({ b }: { b: Batch }) {
  if (b.temperature == null && b.humidity == null)
    return <span className="text-ink-3">Not recorded</span>;
  const day = incubationDay(b) ?? 0;
  const [lo, hi] = day >= 18 ? TARGET.rhLockdown : TARGET.rh;
  const tOff = b.temperature != null && Math.abs(b.temperature - TARGET.temp) > 0.3;
  const hOff = b.humidity != null && (b.humidity < lo || b.humidity > hi);
  return (
    <span
      className="pg-num whitespace-nowrap"
      title={`Recommended ${formatTemp(TARGET.temp)} and ${lo}–${hi}% RH${day >= 18 ? " in lockdown" : ""}`}
    >
      <span className={tOff ? "text-warn" : "text-ink"}>
        {b.temperature != null ? formatTemp(b.temperature) : "—"}
      </span>
      <span className="text-ink-3"> · </span>
      <span className={hOff ? "text-warn" : "text-ink"}>
        {b.humidity != null ? `${formatNumber(b.humidity, { maximumFractionDigits: 0 })}% RH` : "—"}
      </span>
      {(tOff || hOff) && <span className="sr-only"> (outside the recommended range)</span>}
    </span>
  );
}

const columns = (canManage: boolean, onRecord: (b: Batch) => void): Column<Batch>[] => [
  {
    key: "batch",
    header: "Batch",
    mobile: "title",
    cell: (b) => (
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{b.name}</div>
        {b.farm_name && <div className="pg-t-caption truncate">{b.farm_name}</div>}
      </div>
    ),
  },
  {
    key: "stage",
    header: "Stage",
    mobile: "status",
    cell: (b) => {
      const s = stage(b, incubationDay(b));
      return <StatusPill status={s.status}>{s.label}</StatusPill>;
    },
  },
  {
    key: "progress",
    header: "Progress",
    className: "md:w-[260px]",
    cell: (b) => {
      const day = incubationDay(b);
      if (day == null) return <span className="text-ink-3">—</span>;
      const next = nextStep(day);
      return (
        <div className="min-w-0">
          <div className="whitespace-nowrap">
            <span className="pg-mono text-ink">
              Day {Math.min(day, TOTAL)}
              <span className="text-ink-3">/{TOTAL}</span>
            </span>
            {next && <span className="text-ink-3"> · {next}</span>}
          </div>
          <div className="hidden md:block">
            <IncubationTrack day={day} done={b.hatched_count != null} />
          </div>
        </div>
      );
    },
  },
  {
    key: "eggs",
    header: "Eggs",
    align: "right",
    cell: (b) => (
      <span className="pg-mono">{formatNumber(b.egg_count, { maximumFractionDigits: 0 })}</span>
    ),
  },
  {
    key: "hatched",
    header: "Hatched",
    align: "right",
    cell: (b) =>
      b.hatched_count == null && canManage && (incubationDay(b) ?? 0) >= 18 ? (
        <Button size="sm" variant="ghost" onClick={() => onRecord(b)}>
          Record hatch
        </Button>
      ) : b.hatched_count != null ? (
        <span className="pg-mono">
          {formatNumber(b.hatched_count, { maximumFractionDigits: 0 })}
          {b.egg_count ? (
            <span className="ml-1 text-[12px] text-ink-3">
              {Math.round((b.hatched_count / b.egg_count) * 100)}%
            </span>
          ) : null}
        </span>
      ) : (
        <span className="text-ink-3">—</span>
      ),
  },
  {
    key: "setting",
    header: "Incubator set to",
    align: "right",
    cell: (b) => <Setting b={b} />,
  },
  {
    key: "hatch",
    header: "Expected hatch",
    cell: (b) =>
      b.expected_hatch_at ? (
        <span className="whitespace-nowrap">{formatDate(b.expected_hatch_at)}</span>
      ) : (
        <span className="text-ink-3">—</span>
      ),
  },
];

/* ------------------------------------------------------------------------ */

function StartBatch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const farms = useQuery({ queryKey: ["farms-list"], queryFn: () => listFarms(), enabled: open });
  const [farmId, setFarmId] = useState("");
  const [name, setName] = useState("");
  const [eggs, setEggs] = useState("");
  const [setTemp, setSetTemp] = useState("");
  const [setRh, setSetRh] = useState("");
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  const eggCount = eggs === "" ? NaN : Number(eggs);
  // Entered in the display unit (°C or °F); stored in °C (2 dp).
  const tempIn = setTemp.trim() === "" ? null : Number(setTemp.replace(",", "."));
  const tempC = fromTemp(tempIn);
  const tempN = tempIn == null ? null : tempC == null ? NaN : Math.round(tempC * 100) / 100;
  const rhN = setRh.trim() === "" ? null : Number(setRh.replace(",", "."));
  const errors = {
    name: !name.trim() ? "Give the batch a name." : undefined,
    eggs:
      !Number.isInteger(eggCount) || eggCount <= 0 ? "Enter how many eggs were set." : undefined,
    temp:
      tempN != null && !(tempN >= 30 && tempN <= 40)
        ? `Enter a temperature between ${formatNumber(toTemp(30))} and ${formatTemp(40)}, or leave it blank.`
        : undefined,
    rh:
      rhN != null && !(rhN >= 20 && rhN <= 90)
        ? "Enter a humidity between 20 and 90%, or leave it blank."
        : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const hatchOn = formatDate(Date.now() + TOTAL * DAY);

  function reset() {
    setFarmId("");
    setName("");
    setEggs("");
    setSetTemp("");
    setSetRh("");
    setTried(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    setSaving(true);
    try {
      await createHatchery({
        data: {
          farmId: farmId || undefined,
          name: name.trim(),
          eggCount,
          temperature: tempN,
          humidity: rhN,
        },
      });
    } catch (err) {
      setSaving(false);
      toast.error(err instanceof Error ? err.message : "Couldn’t start the batch");
      return;
    }
    setSaving(false);
    toast.success(`${name.trim()} started · hatch due ${hatchOn}`);
    await qc.invalidateQueries({ queryKey: ["hatcheries"] });
    onOpenChange(false);
    reset();
  }

  const show = (k: keyof typeof errors) => (tried ? errors[k] : undefined);

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
      title="Start batch"
      description={`Set today. Hatch expected ${hatchOn}, after ${TOTAL} days.`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form="start-batch" loading={saving}>
            Start batch
          </Button>
        </>
      }
    >
      <form id="start-batch" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field
          label="Farm"
          hint={farms.data?.length ? undefined : "A farm is created for you if you have none."}
        >
          <Select name="farm" value={farmId} onChange={(e) => setFarmId(e.target.value)}>
            <option value="">{farms.data?.length ? "Default farm" : "Create default farm"}</option>
            {farms.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Batch name" required error={show("name")}>
          <Input
            name="batch-name"
            autoComplete="off"
            placeholder="Incubator A · Oct 19…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Eggs set" required error={show("eggs")}>
          <Input
            name="eggs"
            inputMode="numeric"
            autoComplete="off"
            placeholder="240…"
            value={eggs}
            onChange={(e) => setEggs(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={`Incubator temp (${tempUnit()})`}
            hint="Optional. What it’s set to."
            error={show("temp")}
          >
            <Input
              name="set-temp"
              inputMode="decimal"
              autoComplete="off"
              placeholder={`${formatNumber(toTemp(TARGET.temp))}…`}
              value={setTemp}
              onChange={(e) => setSetTemp(e.target.value.replace(/[^\d.,]/g, ""))}
            />
          </Field>
          <Field label="Incubator RH (%)" hint="Optional." error={show("rh")}>
            <Input
              name="set-rh"
              inputMode="decimal"
              autoComplete="off"
              placeholder={`${TARGET.rh[0]}…`}
              value={setRh}
              onChange={(e) => setSetRh(e.target.value.replace(/[^\d.,]/g, ""))}
            />
          </Field>
        </div>
        <p className="rounded-md bg-sunken px-3 py-2 text-[13px] leading-[18px] text-ink-2">
          Recommended <span className="pg-num">{formatTemp(TARGET.temp)}</span> and{" "}
          <span className="pg-num">
            {TARGET.rh[0]}–{TARGET.rh[1]}%
          </span>{" "}
          RH. Candle on day 7 and 14, lockdown from day 18. Nothing measures the incubator, so the
          app only shows what you enter.
        </p>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------------ */

function RecordHatch({ batch, onClose }: { batch: Batch | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [count, setCount] = useState("");
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const n = count === "" ? NaN : Number(count);
  const max = batch?.egg_count ?? Infinity;
  const error =
    !Number.isInteger(n) || n < 0
      ? "Enter how many chicks hatched."
      : n > max
        ? `That’s more than the ${formatNumber(max)} eggs set.`
        : undefined;

  function close() {
    setCount("");
    setTried(false);
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!batch || error) return;
    setSaving(true);
    try {
      await recordHatch({ data: { id: batch.id, hatchedCount: n } });
      toast.success(`${batch.name}: ${formatNumber(n)} chicks recorded`);
      await qc.invalidateQueries({ queryKey: ["hatcheries"] });
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t save the hatch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!batch}
      onOpenChange={(v) => !v && close()}
      title="Record hatch"
      description={
        batch ? `${batch.name} · ${formatNumber(batch.egg_count ?? 0)} eggs set` : undefined
      }
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="record-hatch" loading={saving}>
            Record hatch
          </Button>
        </>
      }
    >
      <form id="record-hatch" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Chicks hatched" required error={tried ? error : undefined}>
          <Input
            name="hatched"
            inputMode="numeric"
            autoComplete="off"
            placeholder="212…"
            value={count}
            onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
      </form>
    </Modal>
  );
}
