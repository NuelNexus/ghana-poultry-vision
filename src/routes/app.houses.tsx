import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createHouse, listFarms, listHouses } from "@/lib/api/farm.functions";
import { AiStatusBadge, PHASE_LABEL, isStale } from "@/components/ai-status";
import { useAuth } from "@/lib/auth";
import type { House, Reading } from "@/lib/api/types";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  Meter,
  Metric,
  MetricGrid,
  Modal,
  PageHeader,
  QueryState,
  RelativeTime,
  Select,
  SkeletonMetrics,
  SkeletonRows,
  formatDate,
  formatNumber,
  formatTemp,
  tempUnit,
  toTemp,
  toTempDelta,
  useDisplayPrefs,
  type Column,
  type Status,
} from "@/components/ui-kit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/houses")({ component: Houses });

const DAY = 86_400_000;

type Row = House & { r: Reading | undefined; live: boolean };

/** Flock age in days from the batch start date, or the edge AI's own estimate. */
function flockAge(h: House, r: Reading | undefined) {
  if (h.batch_started_at) {
    return Math.max(0, Math.floor((Date.now() - new Date(h.batch_started_at).getTime()) / DAY));
  }
  return r?.bird_age_days != null ? Math.round(r.bird_age_days) : null;
}

function occupancyStatus(ratio: number): Status {
  return ratio > 1 ? "crit" : ratio > 0.95 ? "warn" : "brand";
}

function Houses() {
  // Re-render when the temperature unit or clock preference changes.
  useDisplayPrefs();
  const [open, setOpen] = useState(false);
  const { canManage } = useAuth();
  const q = useQuery({
    queryKey: ["houses"],
    queryFn: () => listHouses(),
    refetchInterval: 15_000,
  });

  const rows: Row[] | undefined = q.data?.houses.map((h) => {
    const r = q.data.latest[h.id];
    return { ...h, r, live: !!r && !isStale(r) };
  });
  const count = rows?.length ?? 0;

  const addButton = canManage ? (
    <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
      Add house
    </Button>
  ) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="mb-2 md:mb-2"
        title="Houses"
        meta={
          rows && count > 0 ? (
            <>
              <span>
                {count} {count === 1 ? "house" : "houses"}
              </span>
              {!canManage && <span>Adding houses needs a manager role</span>}
            </>
          ) : undefined
        }
      >
        {count > 0 && addButton}
      </PageHeader>

      <QueryState
        query={q}
        loading={
          <div className="flex flex-col gap-6" aria-busy>
            <SkeletonMetrics count={4} cols={4} />
            <SkeletonRows rows={4} cols={6} />
          </div>
        }
        errorTitle="Couldn’t load houses"
        isEmpty={(d) => d.houses.length === 0}
        empty={
          <EmptyState
            title="No houses yet"
            description="Each house shows its Raspberry Pi’s latest temperature, humidity, gas level and AI condition here, with occupancy and flock age."
            action={addButton}
            secondary={
              <Link
                to="/app/devices"
                className="text-[14px] font-medium text-brand underline decoration-brand/30 underline-offset-4 transition-colors hover:decoration-brand"
              >
                Set up the Raspberry Pi
              </Link>
            }
            note={
              canManage
                ? undefined
                : "Ask a farm manager to add houses. Your role can view them once added."
            }
          />
        }
      >
        {() => (
          <>
            <Summary rows={rows!} />
            <DataTable caption="Houses" rows={rows} rowKey={(h) => h.id} columns={columns} />
          </>
        )}
      </QueryState>

      <AddHouse open={open} onOpenChange={setOpen} />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function Summary({ rows }: { rows: Row[] }) {
  const birds = rows.reduce((s, h) => s + (h.bird_count ?? 0), 0);
  const capacity = rows.reduce((s, h) => s + (h.capacity ?? 0), 0);
  const live = rows.filter((h) => h.live);
  const attention = live.filter((h) => h.r?.ai_status && h.r.ai_status !== "healthy");
  const crit = attention.some((h) => h.r?.ai_status === "critical");
  const offline = rows.length - live.length;

  return (
    <MetricGrid cols={4}>
      <Metric
        label="Birds housed"
        value={formatNumber(birds, { maximumFractionDigits: 0 })}
        sub={
          capacity
            ? `of ${formatNumber(capacity, { maximumFractionDigits: 0 })} capacity`
            : "No capacity set"
        }
      />
      <Metric
        label="Occupancy"
        value={capacity ? Math.round((birds / capacity) * 100) : null}
        unit="%"
        sub={
          capacity
            ? `${formatNumber(Math.max(0, capacity - birds), { maximumFractionDigits: 0 })} places free`
            : undefined
        }
      />
      <Metric
        label="Reporting live"
        value={`${live.length}/${rows.length}`}
        status={offline === 0 ? "ok" : live.length === 0 ? "offline" : "warn"}
        sub={offline ? `${offline} without a reading in 5 min` : "All houses reporting"}
      />
      <Metric
        label="Need attention"
        value={attention.length}
        status={attention.length ? (crit ? "crit" : "warn") : undefined}
        sub={
          attention.length
            ? attention.map((h) => h.name).join(", ")
            : live.length
              ? "Live houses are healthy"
              : "No live AI readings"
        }
      />
    </MetricGrid>
  );
}

/* ------------------------------------------------------------------------ */

function Num({
  value,
  unit,
  muted,
}: {
  value: number | null | undefined;
  unit: string;
  muted?: boolean;
}) {
  if (value == null) return <span className="text-ink-3">—</span>;
  return (
    <span className={cn("pg-mono", muted ? "text-ink-3" : "text-ink")}>
      {formatNumber(value)}
      {unit && <span className="ml-0.5 text-[12px] text-ink-3">{unit}</span>}
    </span>
  );
}

function TempCell({ h }: { h: Row }) {
  const t = h.r?.temperature;
  const target = h.r?.target_temp;
  // °C for the thresholds; shown converted to the display unit.
  const diff = t != null && target != null ? t - target : null;
  const off = diff != null && Math.abs(diff) >= 2;
  const shown = toTempDelta(diff);
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <Num value={toTemp(t)} unit={tempUnit()} muted={!h.live} />
      {diff != null && (
        <span
          className={cn(
            "pg-mono text-[12px]",
            h.live && off ? (Math.abs(diff) >= 4 ? "text-crit" : "text-warn") : "text-ink-3",
          )}
          title={`Target ${formatTemp(target)} for this age`}
        >
          {diff > 0 ? "+" : diff < 0 ? "−" : "±"}
          {formatNumber(Math.abs(shown!))}
          <span className="sr-only">
            {" "}
            {diff > 0 ? "above" : "below"} the {formatTemp(target)} target
          </span>
        </span>
      )}
    </span>
  );
}

const columns: Column<Row>[] = [
  {
    key: "house",
    header: "House",
    mobile: "title",
    cell: (h) => (
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{h.name}</div>
        <div className="pg-t-caption truncate">
          {[h.batch_name ?? "No batch", h.farm_name].filter(Boolean).join(" · ")}
        </div>
      </div>
    ),
  },
  {
    key: "status",
    header: "Condition",
    mobile: "status",
    cell: (h) =>
      h.r ? (
        <AiStatusBadge status={h.r.ai_status} at={h.r.created_at} />
      ) : (
        <span className="pg-t-caption">No Pi assigned</span>
      ),
  },
  {
    key: "temp",
    header: "Temp",
    align: "right",
    cell: (h) => <TempCell h={h} />,
  },
  {
    key: "rh",
    header: "Humidity",
    align: "right",
    cell: (h) => <Num value={h.r?.humidity} unit="%" muted={!h.live} />,
  },
  {
    key: "gas",
    header: "Gas",
    align: "right",
    cell: (h) => <Num value={h.r?.gas_index} unit="" muted={!h.live} />,
  },
  {
    key: "birds",
    header: "Birds",
    className: "w-[168px]",
    cell: (h) => {
      const ratio = h.capacity ? (h.bird_count ?? 0) / h.capacity : null;
      return (
        <div className="min-w-0">
          <div className="pg-mono text-[13px] text-ink whitespace-nowrap">
            {formatNumber(h.bird_count ?? 0, { maximumFractionDigits: 0 })}
            <span className="text-ink-3">
              {" / "}
              {h.capacity ? formatNumber(h.capacity, { maximumFractionDigits: 0 }) : "—"}
            </span>
          </div>
          {ratio != null && (
            <Meter
              value={ratio}
              status={occupancyStatus(ratio)}
              className="mt-1 hidden w-[120px] md:block"
            />
          )}
        </div>
      );
    },
  },
  {
    key: "age",
    header: "Flock age",
    cell: (h) => {
      const age = flockAge(h, h.r);
      if (age == null) return <span className="text-ink-3">—</span>;
      const phase = h.r?.growth_phase ? PHASE_LABEL[h.r.growth_phase]?.split(" (")[0] : null;
      return (
        <span
          className="whitespace-nowrap"
          title={
            h.batch_started_at
              ? `Placed ${formatDate(h.batch_started_at)}`
              : "Estimated by the edge AI"
          }
        >
          <span className="pg-mono text-ink">Day {age}</span>
          {phase && <span className="text-ink-3"> · {phase}</span>}
        </span>
      );
    },
  },
  {
    key: "seen",
    header: "Last reading",
    cell: (h) =>
      h.r ? (
        <RelativeTime
          iso={h.r.created_at}
          className={cn("whitespace-nowrap", h.live ? "text-ink-2" : "font-medium text-ink-2")}
        />
      ) : (
        <span className="text-ink-3">Never</span>
      ),
  },
];

/* ------------------------------------------------------------------------ */

function AddHouse({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const farms = useQuery({ queryKey: ["farms-list"], queryFn: () => listFarms(), enabled: open });
  const [farmId, setFarmId] = useState("");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("1000");
  const [birdCount, setBirdCount] = useState("");
  const [batch, setBatch] = useState("");
  const [batchStart, setBatchStart] = useState("");
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  const cap = capacity === "" ? NaN : Number(capacity);
  const birds = birdCount === "" ? 0 : Number(birdCount);
  const errors = {
    name: !name.trim() ? "Give the house a name." : undefined,
    capacity: !Number.isInteger(cap) || cap < 0 ? "Enter a whole number." : undefined,
    birds:
      !Number.isInteger(birds) || birds < 0
        ? "Enter a whole number."
        : Number.isInteger(cap) && birds > cap
          ? "More birds than the house can hold."
          : undefined,
    date:
      batchStart && new Date(batchStart).getTime() > Date.now()
        ? "Use today or an earlier date."
        : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);

  function reset() {
    setFarmId("");
    setName("");
    setCapacity("1000");
    setBirdCount("");
    setBatch("");
    setBatchStart("");
    setTried(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    setSaving(true);
    try {
      await createHouse({
        data: {
          farmId: farmId || undefined,
          name: name.trim(),
          capacity: cap,
          birdCount: birds,
          batchName: batch.trim() || undefined,
          batchStartedAt: batchStart || undefined,
        },
      });
    } catch (err) {
      setSaving(false);
      toast.error(err instanceof Error ? err.message : "Couldn’t add the house");
      return;
    }
    setSaving(false);
    toast.success(`${name.trim()} added`);
    await qc.invalidateQueries({ queryKey: ["houses"] });
    onOpenChange(false);
    reset();
  }

  const show = (k: keyof typeof errors) => (tried ? errors[k] : undefined);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
      title="Add house"
      description="Readings appear once a Raspberry Pi is assigned to this house under Devices."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-house" loading={saving}>
            Add house
          </Button>
        </>
      }
    >
      <form id="add-house" onSubmit={submit} noValidate className="flex flex-col gap-4">
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
        <Field label="House name" required error={show("name")}>
          <Input
            name="house-name"
            autoComplete="off"
            placeholder="House 3…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Bird capacity" required error={show("capacity")}>
            <Input
              name="capacity"
              inputMode="numeric"
              autoComplete="off"
              placeholder="5000…"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
          <Field label="Birds placed" error={show("birds")}>
            <Input
              name="birds"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0…"
              value={birdCount}
              onChange={(e) => setBirdCount(e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
        </div>
        <Field label="Batch name">
          <Input
            name="batch"
            autoComplete="off"
            placeholder="Broilers Oct 2026…"
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
          />
        </Field>
        <Field
          label="Chicks placed on"
          hint="Sets flock age, which drives the edge AI’s temperature targets."
          error={show("date")}
        >
          <Input
            type="date"
            name="placed-on"
            max={today}
            value={batchStart}
            onChange={(e) => setBatchStart(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
