import { createFileRoute, Link } from "@tanstack/react-router";
import { Leaf, Activity, Cpu, Sun, Camera, Egg, Bell, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PoultryGrid AI — Smart Poultry Farm Management for Ghana" },
      { name: "description", content: "Real-time IoT monitoring, AI health insights, hatchery management and renewable energy for poultry farms across Ghana." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
              <Leaf className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-semibold">PoultryGrid AI</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
            <Link to="/login" search={{ mode: "signup" }}
              className="text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent text-accent-foreground text-xs">
            Built for poultry farms in Ghana
          </div>
          <h1 className="mt-4 text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
            Smart poultry farm management,<br />powered by IoT and AI.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Monitor temperature, humidity, hatcheries, cameras, solar power and biogas in real time.
            Predict disease risk, automate feeders and ventilation, and run your farms from anywhere.
          </p>
          <div className="mt-7 flex gap-3">
            <Link to="/login" search={{ mode: "signup" }}
              className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md font-medium hover:bg-primary/90">
              Create free account
            </Link>
            <Link to="/login"
              className="border border-border bg-card px-5 py-2.5 rounded-md font-medium hover:bg-accent">
              Sign in
            </Link>
          </div>
        </div>

        <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { i: Activity, t: "Real-time monitoring", d: "Temperature, humidity, gas, water and feed levels from ESP32 devices." },
            { i: Egg, t: "Hatchery management", d: "Incubator control with hatch prediction and success tracking." },
            { i: Camera, t: "Live ESP32-CAM", d: "Multi-feed video monitoring with snapshots and recording." },
            { i: Sun, t: "Renewable energy", d: "Solar generation, battery and waste-to-energy biogas tracking." },
            { i: Cpu, t: "Device management", d: "Register, monitor and OTA-update ESP32 devices across farms." },
            { i: Bell, t: "Smart alerts", d: "Disease, power and offline alerts with severity routing." },
            { i: BarChart3, t: "Reports & analytics", d: "Daily, weekly, monthly with PDF and Excel export." },
            { i: Leaf, t: "Multi-farm ready", d: "Operate many farms with role-based access for teams." },
          ].map((f) => (
            <div key={f.t} className="rounded-lg border border-border bg-card p-5">
              <f.i className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-medium">{f.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-6 text-sm text-muted-foreground flex justify-between">
          <div>© {new Date().getFullYear()} PoultryGrid AI</div>
          <div>Made for Ghanaian farmers</div>
        </div>
      </footer>
    </div>
  );
}
