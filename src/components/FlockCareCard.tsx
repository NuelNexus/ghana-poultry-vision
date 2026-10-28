import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Syringe, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { setHouseFlockType } from "@/lib/api/farm.functions";
import { flockCareQuery } from "@/lib/flock-care-query";
import { FLOCK_LABEL, FLOCK_TYPES, whenText, type FlockCare } from "@/lib/vaccine-schedule";
import { useAuth } from "@/lib/auth";
import { useLanguage } from "@/components/LanguageProvider";
import { useSiteSpeech } from "@/components/AccessDock";
import { Badge, Button, Skeleton } from "@/components/ui-kit";
import { cn } from "@/lib/utils";

// "Flock care today": each house's step on the broiler or layer vaccination
// schedule, the next vaccine, and a button that reads it out in the site
// language. Loading it also raises the vaccine-day alert (see getFlockCare).

export function FlockCareCard({ className, compact }: { className?: string; compact?: boolean }) {
  const q = useQuery(flockCareQuery);
  const { translate } = useLanguage();
  const { say, speaking } = useSiteSpeech();
  const care = q.data ?? [];

  const hear = async () => {
    const lines = await translate(care.map((c) => c.summary));
    void say(lines.join(" "), "flock-care");
  };

  if (q.isError) return null;
  if (!q.isPending && care.length === 0) return null;

  return (
    <section
      className={cn(compact ? "px-4 py-3" : "pg-panel p-4 md:p-5", className)}
      aria-labelledby="flock-care-h"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="flock-care-h" className="flex items-center gap-1.5 pg-t-h3">
          <Syringe className="size-4 text-ink-3" strokeWidth={1.75} aria-hidden />
          Flock care today
        </h2>
        {care.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={Volume2}
            loading={speaking}
            onClick={() => void hear()}
          >
            Hear it
          </Button>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="mt-3 h-10 w-full" />
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {care.map((c) => (
            <HouseCare key={c.houseId} c={c} />
          ))}
        </ul>
      )}
      <p className="pg-t-caption mt-3">
        Farmsquare schedule. It can differ by area: ask your vet before changing it.
      </p>
    </section>
  );
}

function HouseCare({ c }: { c: FlockCare }) {
  const { canManage } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const pick = async (flockType: (typeof FLOCK_TYPES)[number]) => {
    setSaving(true);
    try {
      await setHouseFlockType({ data: { houseId: c.houseId, flockType } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["flock-care"] }),
        qc.invalidateQueries({ queryKey: ["houses"] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t save");
    }
    setSaving(false);
  };

  const ready = c.flockType && c.day != null && c.day >= 1;
  return (
    <li className="text-[13px] leading-[18px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-ink">{c.house}</span>
        {ready && (
          <span className="pg-mono text-ink-3">
            Day {c.day} · {FLOCK_LABEL[c.flockType!]}
          </span>
        )}
        {c.vaccineToday && <Badge tone="warning">Vaccine {whenText(c.vaccineToday)}</Badge>}
      </div>
      {ready ? (
        <>
          {c.vaccineToday ? (
            <p className="mt-0.5 text-ink">
              <strong>{c.vaccineToday.task}</strong>, {c.vaccineToday.how}.
            </p>
          ) : (
            <p className="mt-0.5 text-ink-2">
              {c.today.length
                ? `${c.today.map((i) => i.task).join(" and ")}, ${c.today[0].how}.`
                : "Nothing on the schedule today."}
            </p>
          )}
          {c.next && (
            <p className="mt-0.5 text-ink-3">
              Next vaccine: {c.next.item.task}, in {c.next.inDays} day
              {c.next.inDays === 1 ? "" : "s"}.
            </p>
          )}
          {!c.next && !c.vaccineToday && (
            <p className="mt-0.5 text-ink-3">No more vaccines on this schedule.</p>
          )}
        </>
      ) : (
        <>
          <p className="mt-0.5 text-ink-2">{c.summary.replace(`${c.house}: `, "")}</p>
          {!c.flockType && canManage && (
            <div className="mt-1.5 flex gap-2">
              {FLOCK_TYPES.map((t) => (
                <Button key={t} size="sm" disabled={saving} onClick={() => void pick(t)}>
                  {FLOCK_LABEL[t]}
                </Button>
              ))}
            </div>
          )}
          {!c.placedOn && (
            <Link
              to="/app/houses"
              className="mt-1 inline-block text-[12px] font-medium text-brand underline-offset-4 hover:underline"
            >
              Go to houses
            </Link>
          )}
        </>
      )}
    </li>
  );
}
