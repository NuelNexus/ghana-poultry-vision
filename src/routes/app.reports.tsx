import { createFileRoute } from "@tanstack/react-router";
import { FileBarChart, FileText, Download } from "lucide-react";
import { PageHeader, Card } from "@/components/ui-kit";

export const Route = createFileRoute("/app/reports")({ component: Reports });

function Reports() {
  const reports = [
    { name: "Daily operations", desc: "Bird counts, temperatures, feed and alerts.", range: "Today" },
    { name: "Weekly productivity", desc: "Hatchery success and mortality trends.", range: "This week" },
    { name: "Monthly analytics", desc: "Full farm performance summary.", range: "This month" },
    { name: "Energy report", desc: "Solar generation and consumption.", range: "Last 30 days" },
  ];
  return (
    <div>
      <PageHeader title="Reports & analytics" description="Generate and export farm reports." />
      <div className="grid md:grid-cols-2 gap-4">
        {reports.map((r) => (
          <Card key={r.name} title={r.name}>
            <p className="text-sm text-muted-foreground">{r.desc}</p>
            <div className="mt-3 text-xs text-muted-foreground">{r.range}</div>
            <div className="mt-4 flex gap-2">
              <button className="inline-flex items-center gap-2 text-sm border border-border bg-background px-3 py-1.5 rounded-md hover:bg-accent">
                <FileText className="h-3.5 w-3.5" /> PDF
              </button>
              <button className="inline-flex items-center gap-2 text-sm border border-border bg-background px-3 py-1.5 rounded-md hover:bg-accent">
                <Download className="h-3.5 w-3.5" /> Excel
              </button>
            </div>
          </Card>
        ))}
      </div>
      <Card title="Charts" className="mt-6">
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <FileBarChart className="h-10 w-10" />
          <p className="mt-2 text-sm">Analytics charts populate as devices report data.</p>
        </div>
      </Card>
    </div>
  );
}
