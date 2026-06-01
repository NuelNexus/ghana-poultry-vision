import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui-kit";

export const Route = createFileRoute("/app/alerts")({ component: Alerts });

function Alerts() {
  const q = useQuery({
    queryKey: ["alerts-all"],
    queryFn: async () => (await supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(100)).data ?? [],
  });

  useEffect(() => {
    const ch = supabase.channel("alerts-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts" }, () => { q.refetch(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [q]);

  async function resolve(id: string) {
    const { error } = await supabase.from("alerts").update({ resolved: true }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Resolved"); q.refetch(); }
  }

  return (
    <div>
      <PageHeader title="Alerts center" description="Realtime alerts across all your farms." />
      {q.data?.length === 0 ? (
        <EmptyState icon={Bell} title="No alerts" description="All systems are running smoothly." />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {q.data?.map((a) => (
              <li key={a.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={a.severity === "critical" ? "destructive" : a.severity === "warning" ? "warning" : "default"}>{a.severity}</Badge>
                    <span className="text-xs text-muted-foreground">{a.type}</span>
                  </div>
                  <div className="mt-1 text-sm">{a.message}</div>
                  <div className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</div>
                </div>
                {!a.resolved && (
                  <button onClick={() => resolve(a.id)} className="text-xs border border-border px-3 py-1.5 rounded-md hover:bg-accent">Resolve</button>
                )}
                {a.resolved && <Badge tone="success">Resolved</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
