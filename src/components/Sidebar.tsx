import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Warehouse, Egg, Activity, Camera, Cpu, Sun, Recycle,
  FileBarChart, Bell, Settings, LogOut, Leaf,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/app/houses", label: "Houses", icon: Warehouse },
  { to: "/app/hatchery", label: "Hatchery", icon: Egg },
  { to: "/app/health", label: "AI Health", icon: Activity },
  { to: "/app/cameras", label: "Cameras", icon: Camera },
  { to: "/app/automation", label: "Automation", icon: Settings },
  { to: "/app/energy", label: "Energy", icon: Sun },
  { to: "/app/biogas", label: "Biogas", icon: Recycle },
  { to: "/app/reports", label: "Reports", icon: FileBarChart },
  { to: "/app/alerts", label: "Alerts", icon: Bell },
  { to: "/app/devices", label: "Devices", icon: Cpu },
];

export function Sidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { signOut, user } = useAuth();
  return (
    <aside className="hidden md:flex w-60 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="px-5 py-5 flex items-center gap-2 border-b border-sidebar-border">
        <div className="h-9 w-9 rounded-md bg-primary flex items-center justify-center">
          <Leaf className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <div className="font-semibold text-sidebar-foreground leading-tight">PoultryGrid</div>
          <div className="text-xs text-muted-foreground">AI Farm Platform</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-3">
        {nav.map((n) => {
          const active = n.exact ? path === n.to : path === n.to || path.startsWith(n.to + "/");
          return (
            <Link key={n.to} to={n.to}
              className={cn(
                "flex items-center gap-3 px-5 py-2.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors",
                active && "bg-sidebar-accent font-medium border-r-2 border-primary"
              )}>
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">{user?.email}</div>
        <button onClick={signOut}
          className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-sidebar-accent text-sidebar-foreground">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}

export function BottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const items = nav.slice(0, 5);
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t border-border flex justify-around">
      {items.map((n) => {
        const active = n.exact ? path === n.to : path === n.to || path.startsWith(n.to + "/");
        return (
          <Link key={n.to} to={n.to}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-2 text-xs",
              active ? "text-primary" : "text-muted-foreground"
            )}>
            <n.icon className="h-5 w-5" />
            <span>{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
