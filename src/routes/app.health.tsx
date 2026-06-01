import { createFileRoute } from "@tanstack/react-router";
import { Activity, TrendingDown, AlertCircle, Heart } from "lucide-react";
import { PageHeader, StatCard, Card, Badge } from "@/components/ui-kit";

export const Route = createFileRoute("/app/health")({ component: Health });

function Health() {
  const risks = [
    { name: "Coccidiosis", risk: "Low", tone: "success" as const, score: 12 },
    { name: "Newcastle disease", risk: "Medium", tone: "warning" as const, score: 45 },
    { name: "Avian influenza", risk: "Low", tone: "success" as const, score: 8 },
    { name: "Salmonellosis", risk: "Low", tone: "success" as const, score: 17 },
  ];

  return (
    <div>
      <PageHeader title="AI health monitoring" description="Disease prediction and behavioral anomaly detection." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Overall health" value="Good" icon={Heart} tone="success" />
        <StatCard label="Mortality (7d)" value="0.8" unit="%" icon={TrendingDown} tone="success" />
        <StatCard label="Anomalies detected" value={2} icon={AlertCircle} tone="warning" />
        <StatCard label="Activity index" value="92" unit="/100" icon={Activity} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-6">
        <Card title="Disease risk prediction">
          <ul className="space-y-3">
            {risks.map((r) => (
              <li key={r.name} className="flex items-center justify-between">
                <span className="text-sm">{r.name}</span>
                <div className="flex items-center gap-3 w-2/3">
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full ${r.tone === "success" ? "bg-success" : "bg-warning"}`} style={{ width: `${r.score}%` }} />
                  </div>
                  <Badge tone={r.tone}>{r.risk}</Badge>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-4">Predictions based on temperature, humidity, activity and historical patterns.</p>
        </Card>

        <Card title="Behavioral anomalies">
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <Badge tone="warning">Warning</Badge>
              <div>
                <div className="font-medium">Reduced activity — House B</div>
                <div className="text-xs text-muted-foreground">Detected 2h ago. Check ventilation.</div>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <Badge tone="default">Info</Badge>
              <div>
                <div className="font-medium">Feeding pattern shift — House A</div>
                <div className="text-xs text-muted-foreground">Detected 5h ago. Within normal range.</div>
              </div>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
