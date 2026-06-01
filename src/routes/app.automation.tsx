import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Lightbulb, Droplet, Wind, UtensilsCrossed } from "lucide-react";
import { PageHeader, Card } from "@/components/ui-kit";

export const Route = createFileRoute("/app/automation")({ component: Automation });

function Automation() {
  const [systems, setSystems] = useState([
    { id: "feeder", name: "Automated feeder", icon: UtensilsCrossed, on: true, schedule: "06:00, 12:00, 18:00" },
    { id: "water", name: "Water system", icon: Droplet, on: true, schedule: "Continuous" },
    { id: "ventilation", name: "Ventilation", icon: Wind, on: true, schedule: "Auto by temperature" },
    { id: "lighting", name: "Lighting", icon: Lightbulb, on: false, schedule: "05:00 – 21:00" },
  ]);

  return (
    <div>
      <PageHeader title="Automation control" description="Remote control of feeders, water, ventilation and lighting." />
      <div className="grid md:grid-cols-2 gap-4">
        {systems.map((s) => (
          <Card key={s.id} title={s.name}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><s.icon className="h-5 w-5" /></div>
                <div>
                  <div className="text-sm">Schedule</div>
                  <div className="text-xs text-muted-foreground">{s.schedule}</div>
                </div>
              </div>
              <button onClick={() => setSystems((prev) => prev.map((p) => p.id === s.id ? { ...p, on: !p.on } : p))}
                className={`relative h-6 w-11 rounded-full transition-colors ${s.on ? "bg-primary" : "bg-muted"}`}>
                <span className={`absolute top-0.5 ${s.on ? "right-0.5" : "left-0.5"} h-5 w-5 rounded-full bg-card shadow transition-all`} />
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Card title="Schedule management" className="mt-6">
        <p className="text-sm text-muted-foreground">Add custom schedules from the Admin panel. Active schedules sync to ESP32 controllers via the device API.</p>
      </Card>
    </div>
  );
}
