import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Warehouse, Egg, Activity, Camera, Cpu, Sun, Recycle,
  FileBarChart, Bell, Settings, LogOut,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

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
  const initials = (user?.email ?? "U").slice(0, 2).toUpperCase();

  return (
    <aside className="pg-sidebar">
      <div>
        <div className="pg-user">
          <div className="pg-avatar">{initials}</div>
          <p>{user?.email?.split("@")[0] ?? "Operator"}</p>
        </div>
        <ul className="pg-navlist">
          {nav.map((n) => {
            const active = n.exact ? path === n.to : path === n.to || path.startsWith(n.to + "/");
            return (
              <li key={n.to} className={"pg-navitem" + (active ? " pg-active" : "")}>
                <Link to={n.to}>
                  <n.icon className="pg-nav-icon" />
                  <span className="pg-nav-text">{n.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <ul className="pg-navlist">
        <li className="pg-navitem">
          <button onClick={signOut} type="button" className="pg-logout">
            <LogOut className="pg-nav-icon" />
            <span className="pg-nav-text">Logout</span>
          </button>
        </li>
      </ul>
    </aside>
  );
}

export function BottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const items = nav.slice(0, 5);
  return (
    <nav className="pg-bottomnav md:hidden">
      {items.map((n) => {
        const active = n.exact ? path === n.to : path === n.to || path.startsWith(n.to + "/");
        return (
          <Link key={n.to} to={n.to} className={"pg-bn-item" + (active ? " pg-active" : "")}>
            <n.icon className="pg-nav-icon" />
            <span>{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
