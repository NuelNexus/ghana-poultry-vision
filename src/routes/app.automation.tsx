import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { getAiMonitor, listDevices, updateDevice } from "@/lib/api/farm.functions";
import type { AiSnapshot, FanLevel } from "@/lib/api/types";
import {
  DataTable,
  DescList,
  EmptyAction,
  EmptyState,
  ErrorState,
  PageHeader,
  RelativeTime,
  Section,
  SegmentedControl,
  Skeleton,
  SkeletonRows,
  StatusPill,
  formatFan,
  type Column,
} from "@/components/ui-kit";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/app/automation")({ component: Automation });

type DeviceRow = Awaited<ReturnType<typeof listDevices>>[number];
type Mode = "auto" | FanLevel;

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "auto", label: "AI auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** PWM duty the Pi drives for each level (edge/poultrygrid/features.py FAN_DUTY). */
const FAN_DUTY: Record<FanLevel, number> = { low: 0.25, medium: 0.6, high: 1 };

function Automation() {
  const { canManage } = useAuth();
  const [saving, setSaving] = useState<Record<string, Mode>>({});

  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: () => listDevices(),
    refetchInterval: 15_000,
  });
  const ai = useQuery({
    queryKey: ["automation-ai-latest"],
    queryFn: () => getAiMonitor({ data: { hours: 1 } }),
    refetchInterval: 15_000,
  });

  const pis = devices.data?.filter((d) => d.type === "pi");
  const latestBy = new Map<string, AiSnapshot>(
    (ai.data?.latest ?? []).map((r) => [r.device_id, r]),
  );

  async function setMode(d: DeviceRow, mode: Mode) {
    const fanOverride = mode === "auto" ? null : mode;
    if ((d.fan_override ?? null) === fanOverride) return;
    setSaving((s) => ({ ...s, [d.id]: mode }));
    try {
      await updateDevice({ data: { id: d.id, fanOverride } });
      await devices.refetch();
      toast.success(
        `${d.device_id}: ${fanOverride ? `fan forced ${fanOverride}` : "fan back to AI auto"}`,
        {
          description: d.online
            ? "Sent with the Pi’s next upload, usually within 30 s."
            : "The Pi is offline. It picks this up when it reconnects.",
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t change the fan mode");
    } finally {
      setSaving(({ [d.id]: _drop, ...rest }) => rest);
    }
  }

  const columns: Column<DeviceRow>[] = [
    {
      key: "device",
      header: "Pi",
      mobile: "title",
      cell: (d) => (
        <div className="min-w-0">
          <div className="pg-mono truncate text-[13px] font-medium text-ink">{d.device_id}</div>
          <div className="pg-t-caption truncate font-normal">
            {d.house_name ?? "No house assigned"}
          </div>
        </div>
      ),
    },
    {
      key: "link",
      header: "Device",
      mobile: "status",
      className: "whitespace-nowrap",
      cell: (d) =>
        d.online ? (
          <StatusPill status="ok">Online</StatusPill>
        ) : (
          <StatusPill status="offline">{d.last_seen ? "Offline" : "Never connected"}</StatusPill>
        ),
    },
    {
      key: "mode",
      header: "Mode",
      className: "w-[1%] whitespace-nowrap",
      cell: (d) => {
        const value: Mode = saving[d.id] ?? d.fan_override ?? "auto";
        if (!canManage)
          return (
            <span className="text-ink-2">{value === "auto" ? "AI auto" : `Forced ${value}`}</span>
          );
        return (
          <div
            aria-busy={d.id in saving || undefined}
            className={d.id in saving ? "opacity-60" : undefined}
          >
            <SegmentedControl
              ariaLabel={`Fan mode for ${d.device_id}`}
              activation="manual"
              disabled={d.id in saving}
              value={value}
              options={MODE_OPTIONS}
              onChange={(m) => {
                if (!(d.id in saving)) void setMode(d, m);
              }}
            />
          </div>
        );
      },
    },
    {
      key: "state",
      header: "Override status",
      className: "whitespace-nowrap",
      cell: (d) => <OverrideState d={d} reported={latestBy.get(d.id)} saving={d.id in saving} />,
    },
    {
      key: "reported",
      header: "Last reported fan",
      className: "whitespace-nowrap",
      cell: (d) => {
        const r = latestBy.get(d.id);
        if (ai.isPending) return <Skeleton className="h-3.5 w-20" />;
        if (!r?.fan_level) return <span className="text-ink-3">No report</span>;
        const duty = r.fan_duty != null ? `${Math.round(r.fan_duty * 100)}% PWM` : null;
        return (
          <div className="min-w-0">
            <div className="text-ink">
              {formatFan(r.fan_level, r.fan_rpm)}
              {duty && <span className="text-ink-3"> · {duty}</span>}
            </div>
            <RelativeTime iso={r.created_at} className="pg-t-caption" />
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Automation" className="mb-0 md:mb-0">
        {!canManage && (
          <p className="pg-t-caption inline-flex items-center gap-1.5">
            <Lock className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
            Changing fan modes needs a manager account.
          </p>
        )}
      </PageHeader>

      <Section
        title="Ventilation"
        description="Each Pi sets its fan from the flock’s AI status. Force a level to override it."
      >
        {devices.isPending ? (
          <SkeletonRows rows={2} cols={5} />
        ) : devices.isError || !pis ? (
          <ErrorState
            title="Couldn’t load ventilation"
            error={devices.error}
            onRetry={() => void devices.refetch()}
          />
        ) : pis.length === 0 ? (
          <EmptyState
            title="No Raspberry Pi registered"
            description="Fan control runs on the Pi edge unit. Register one to control ventilation from here."
            action={<EmptyAction to="/app/devices">Open devices</EmptyAction>}
            note={!canManage ? "Ask a farm manager to register a Pi." : undefined}
          />
        ) : (
          <DataTable
            caption="Ventilation by Pi"
            rowKey={(d) => d.id}
            rows={pis}
            columns={columns}
          />
        )}
      </Section>

      <Section
        title="What the Pi controls"
        description="Ventilation is the only thing wired to the Pi. There are no feeder, drinker or lighting controls."
      >
        <div className="pg-panel px-4 py-1 md:px-5">
          <DescList
            items={[
              {
                label: "AI auto",
                value:
                  "Every ~30 s the model picks a level from the flock’s status and its causes. Cold chicks get minimum air, not a blast.",
              },
              {
                label: "Fan levels",
                value: `Low ${FAN_DUTY.low * 100}% · Medium ${FAN_DUTY.medium * 100}% · High ${FAN_DUTY.high * 100}% PWM duty on GPIO 18.`,
              },
              {
                label: "Fan check",
                value:
                  "The tach on GPIO 23 reports rpm. If the fan is driven but not spinning, the model raises a fan fault alert.",
              },
              {
                label: "Monitor only",
                value:
                  "With PG_FAN_AUTO=0 in agent.env the Pi reports a level but leaves the fan alone.",
              },
            ]}
          />
        </div>
      </Section>
    </div>
  );
}

function OverrideState({
  d,
  reported,
  saving,
}: {
  d: DeviceRow;
  reported: AiSnapshot | undefined;
  saving: boolean;
}) {
  if (saving) return <StatusPill status="neutral">Saving…</StatusPill>;
  if (!d.fan_override) return <span className="text-ink-3">None</span>;
  // Applied once the Pi's latest reading shows the forced level. A 0 duty with a
  // level means the agent runs with PG_FAN_AUTO=0 and isn't driving the fan.
  if (reported?.fan_level === d.fan_override) {
    if (reported.fan_duty === 0)
      return (
        <StatusPill status="warn" title="The Pi reports 0% PWM. Is PG_FAN_AUTO=0 in agent.env?">
          Not driving fan
        </StatusPill>
      );
    return <StatusPill status="ok">Applied</StatusPill>;
  }
  return (
    <StatusPill
      status={d.online ? "info" : "offline"}
      title="The Pi hasn’t reported this level yet"
    >
      {d.online ? "Waiting for Pi" : "Pending · Pi offline"}
    </StatusPill>
  );
}
