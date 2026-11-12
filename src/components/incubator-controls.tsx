import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listRelayBoards, setRelays, type RelayBoard } from "@/lib/api/relays.functions";
import { RELAYS, RELAY_INFO, type RelayName, type RelayState } from "@/lib/relays";
import { IncubatorDiagram } from "@/components/incubator-diagram";
import {
  Button,
  EmptyAction,
  EmptyState,
  ErrorState,
  RelativeTime,
  Section,
  SkeletonRows,
  StatusPill,
  Switch,
} from "@/components/ui-kit";

// The incubator relay board (firmware/relay_board) on the Automation page: a 2D
// incubator whose controller, fan, lamp and LED strip are each a button. A change
// is sent to the board on its next check-in (about 1.5 s while this page is open);
// until the board reports the new state the part shows a dashed "sending" ring.

const KEY = ["relay-boards"];

export function IncubatorControlsSection({ canManage }: { canManage: boolean }) {
  const q = useQuery({ queryKey: KEY, queryFn: () => listRelayBoards(), refetchInterval: 2_000 });

  return (
    <Section
      title="Incubator · relay board"
      description="Tap a part of the incubator to switch it on or off. The ESP32 relay board picks up the change in a second or two."
    >
      {q.isPending ? (
        <SkeletonRows rows={3} cols={3} />
      ) : q.isError || !q.data ? (
        <ErrorState
          title="Couldn’t load the relay board"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : q.data.length === 0 ? (
        <EmptyState
          title="No relay board registered"
          description="Register the ESP32 relay board under Devices (Incubator relay board), upload firmware/relay_board, and the incubator shows here."
          action={<EmptyAction to="/app/devices">Open devices</EmptyAction>}
          note={!canManage ? "Ask a farm manager to register it." : undefined}
        />
      ) : (
        <div className="flex flex-col gap-10">
          {q.data.map((b) => (
            <BoardPanel key={b.id} board={b} canManage={canManage} />
          ))}
        </div>
      )}
    </Section>
  );
}

function BoardPanel({ board, canManage }: { board: RelayBoard; canManage: boolean }) {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const want = board.desired;
  const have = board.reported;
  // Waiting for the board to report a change the site asked for.
  const pending = (k: RelayName) => !!have && have[k] !== want[k];

  async function send(patch: Partial<RelayState>) {
    if (!canManage) return;
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

  const toggle = (k: RelayName) => void send({ [k]: !want[k] });
  const allOn = RELAYS.every((k) => want[k]);
  const allOff = RELAYS.every((k) => !want[k]);

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

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <IncubatorDiagram
          state={want}
          pending={pending}
          offline={!board.online}
          disabled={!canManage}
          onToggle={toggle}
        />

        <div className="flex flex-col gap-3">
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
