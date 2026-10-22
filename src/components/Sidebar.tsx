import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Activity,
  Bell,
  Camera,
  ChevronRight,
  Cpu,
  Egg,
  FileText,
  LayoutGrid,
  LogOut,
  Menu,
  MessageSquare,
  SlidersHorizontal,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { listAlerts, listDevices, listFarms } from "@/lib/api/farm.functions";
import {
  formatDateTime,
  freshness,
  useDisplayPrefs,
  useNow,
  type FreshnessState,
} from "@/components/ui-kit";
import { avatarHue, initialsOf } from "@/lib/theme";

/* ------------------------------------------------------------------------ *
 * Navigation model
 * ------------------------------------------------------------------------ */

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Document title override (defaults to label). */
  title?: string;
};
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { to: "/app", label: "Overview", icon: LayoutGrid, exact: true },
      { to: "/app/houses", label: "Houses", icon: Warehouse },
      { to: "/app/health", label: "Flock health", icon: Activity },
      { to: "/app/cameras", label: "Cameras", icon: Camera },
      { to: "/app/alerts", label: "Alerts", icon: Bell },
    ],
  },
  {
    label: "Operate",
    items: [
      { to: "/app/automation", label: "Automation", icon: SlidersHorizontal },
      { to: "/app/hatchery", label: "Hatchery", icon: Egg },
      { to: "/app/devices", label: "Devices", icon: Cpu },
    ],
  },
  {
    label: "Insights",
    items: [
      { to: "/app/reports", label: "Reports", icon: FileText },
      { to: "/app/ai", label: "AI assistant", icon: MessageSquare },
    ],
  },
];

const isActive = (item: NavItem, path: string) =>
  item.exact
    ? path === item.to || path === item.to + "/"
    : path === item.to || path.startsWith(item.to + "/");

/** Current nav item + its group, for breadcrumbs and document titles. */
const PROFILE_ROUTE: { group: NavGroup; item: NavItem } = {
  group: { label: "Account", items: [] },
  item: { to: "/app/profile", label: "Profile", icon: LayoutGrid },
};

export function navItemFor(path: string): { group: NavGroup; item: NavItem } | null {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) if (isActive(item, path)) return { group, item };
  }
  // Reached from the sidebar user block, not the nav list.
  if (path.startsWith("/app/profile")) return PROFILE_ROUTE;
  return null;
}

/* ------------------------------------------------------------------------ *
 * Shared data hooks (query keys match the pages, so caches are shared)
 * ------------------------------------------------------------------------ */

function useOpenAlertCount() {
  const q = useQuery({
    queryKey: ["alerts-all"],
    queryFn: () => listAlerts(),
    refetchInterval: 30_000,
  });
  return q.data ? q.data.filter((a) => !a.resolved).length : 0;
}

function useFarmName() {
  const q = useQuery({ queryKey: ["farms-list"], queryFn: () => listFarms(), staleTime: 300_000 });
  if (!q.data) return q.isError ? null : undefined;
  if (q.data.length > 1) return `${q.data[0].name} +${q.data.length - 1}`;
  return q.data[0]?.name ?? null;
}

export type LiveState = FreshnessState;

/**
 * Freshness of the newest device check-in across the farm, in the shared
 * vocabulary (ui-kit `freshness()`, thresholds FRESHNESS_MS).
 */
export function useLiveState() {
  const q = useQuery({
    queryKey: ["devices"],
    queryFn: () => listDevices(),
    refetchInterval: 30_000,
  });
  const now = useNow(10_000);
  const last = (q.data ?? [])
    .map((d) => (d.last_seen ? new Date(d.last_seen).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const f = freshness(last || null, now);
  return { state: f.state, fresh: f, last: last || null, now, loading: q.isPending };
}

function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/* ------------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------------ */

/** Monogram: house gable over an egg, in brand green. */
export function BrandMark({ className = "pg-brand-mark" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden focusable="false">
      <rect width="28" height="28" rx="6" fill="var(--pg-brand)" />
      <path
        d="M7 13.2 14 7.6l7 5.6"
        fill="none"
        stroke="var(--pg-on-brand)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 12.4c-1.9 0-3.4 2.7-3.4 5.1 0 2 1.5 3.4 3.4 3.4s3.4-1.4 3.4-3.4c0-2.4-1.5-5.1-3.4-5.1Z"
        fill="var(--pg-on-brand)"
      />
    </svg>
  );
}

/** The single global freshness indicator (top bar). Pages don't repeat it. */
export function LiveIndicator({ compact = false }: { compact?: boolean }) {
  const { state, fresh, last, loading } = useLiveState();
  useDisplayPrefs();
  if (loading) return null;
  const word = { live: "Live", delayed: "Delayed", stale: "Stale", none: "No data" }[state];
  const text = compact ? fresh.short : fresh.label;
  return (
    <span
      className="pg-live"
      data-state={state}
      title={
        last ? `Last device check-in: ${formatDateTime(last)}` : "No device has checked in yet"
      }
    >
      <span className={"pg-dot" + (state === "live" ? " pg-dot--pulse" : "")} aria-hidden />
      <span>{text}</span>
      {/* Announce only state changes, not every tick. */}
      <span className="sr-only" aria-live="polite">
        {word}
      </span>
    </span>
  );
}

function AlertsButton() {
  const count = useOpenAlertCount();
  return (
    <Link
      to="/app/alerts"
      className="pg-iconbtn"
      aria-label={count ? `Alerts, ${count} open` : "Alerts"}
    >
      <Bell aria-hidden />
      {count > 0 && <span className="pg-iconbtn-count">{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}

function RailTip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="right"
          sideOffset={10}
          className="z-50 rounded-md bg-ink px-2 py-1 text-[12px] leading-4 font-medium text-paper shadow-pop"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

function NavContent({ rail, onNavigate }: { rail: boolean; onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const alertCount = useOpenAlertCount();
  return (
    <nav aria-label="Main" className="pg-side-scroll">
      {NAV_GROUPS.map((g) => (
        <div key={g.label} className="pg-navgroup">
          <span className="pg-navgroup-label" id={`nav-${g.label}`}>
            {g.label}
          </span>
          <ul className="pg-navlist" aria-labelledby={`nav-${g.label}`}>
            {g.items.map((n) => {
              const active = isActive(n, path);
              const count = n.to === "/app/alerts" ? alertCount : 0;
              return (
                <li key={n.to}>
                  <RailTip label={count ? `${n.label} (${count} open)` : n.label} enabled={rail}>
                    <Link
                      to={n.to}
                      className="pg-navlink"
                      activeOptions={{ exact: !!n.exact, includeSearch: false }}
                      aria-current={active ? "page" : undefined}
                      aria-label={rail ? n.label : undefined}
                      onClick={onNavigate}
                    >
                      <n.icon aria-hidden />
                      <span className="pg-navlabel">{n.label}</span>
                      {count > 0 && (
                        <span className="pg-navcount" aria-label={`${count} open`}>
                          {count > 99 ? "99+" : count}
                        </span>
                      )}
                    </Link>
                  </RailTip>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserFoot({ rail }: { rail: boolean }) {
  const { user, roles, signOut } = useAuth();
  const name = user?.full_name?.trim() || user?.email?.split("@")[0] || "Operator";
  const initials = initialsOf(name);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const onProfile = path.startsWith("/app/profile");
  const role = roles.includes("admin") ? "admin" : roles.includes("manager") ? "manager" : "worker";
  return (
    <div className="pg-side-foot">
      <RailTip label={`${name} · ${role}`} enabled={rail}>
        <Link
          to="/app/profile"
          className="pg-user"
          aria-current={onProfile ? "page" : undefined}
          aria-label={rail ? `${name}, ${role}. Profile and appearance` : undefined}
          title="Profile and appearance"
        >
          <span
            className="pg-avatar"
            aria-hidden
            style={{ "--pg-av": avatarHue(user?.id) } as CSSProperties}
          >
            {initials}
          </span>
          <span className="pg-user-text">
            <span className="pg-user-name" title={user?.email}>
              {name}
            </span>
            <span className="pg-user-role">{role}</span>
          </span>
        </Link>
      </RailTip>
      <RailTip label="Sign out" enabled={rail}>
        <button
          type="button"
          onClick={() => void signOut()}
          className="pg-navlink pg-signout"
          aria-label={rail ? "Sign out" : undefined}
        >
          <LogOut aria-hidden />
          <span className="pg-navlabel">Sign out</span>
        </button>
      </RailTip>
    </div>
  );
}

function BrandBlock({ children }: { children?: ReactNode }) {
  const farm = useFarmName();
  return (
    <div className="pg-brand">
      <Link
        to="/app"
        activeOptions={{ exact: true }}
        activeProps={{ "aria-current": undefined }}
        className="flex min-w-0 items-center gap-2.5 text-ink no-underline"
        aria-label="PoultryGrid overview"
      >
        <BrandMark />
        <span className="pg-brand-text">
          <span className="pg-brand-name" translate="no">
            PoultryGrid
          </span>
          {farm !== null && <span className="pg-brand-farm">{farm ?? ""}</span>}
        </span>
      </Link>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Shell parts
 * ------------------------------------------------------------------------ */

/** Desktop sidebar (≥1024 labelled, 768–1023 icon rail) + phone top bar & drawer. */
export function Sidebar() {
  const rail = useMedia("(min-width: 768px) and (max-width: 1023px)");
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => setOpen(false), [path]);

  return (
    <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={200}>
      <aside className="pg-side" aria-label="Sidebar">
        <BrandBlock />
        <NavContent rail={rail} />
        <UserFoot rail={rail} />
      </aside>

      {/* Phone top bar */}
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <header className="pg-mbar">
          <DialogPrimitive.Trigger className="pg-iconbtn" aria-label="Open menu">
            <Menu aria-hidden />
          </DialogPrimitive.Trigger>
          <div className="pg-mbar-title">
            {/* Brand, not the page name: the page h1 sits right below. */}
            <BrandMark className="size-6 shrink-0" />
            <span translate="no">PoultryGrid</span>
          </div>
          <LiveIndicator compact />
          <AlertsButton />
        </header>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="pg-console pg-drawer-overlay" />
          <DialogPrimitive.Content className="pg-console pg-drawer" aria-describedby={undefined}>
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <BrandBlock>
              <DialogPrimitive.Close
                className="pg-iconbtn"
                aria-label="Close menu"
                style={{ width: 44, height: 44 }}
              >
                <X aria-hidden />
              </DialogPrimitive.Close>
            </BrandBlock>
            <NavContent rail={false} onNavigate={() => setOpen(false)} />
            <UserFoot rail={false} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/** Desktop/tablet bar above content: breadcrumb left, live + alerts right. */
export function TopBar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = navItemFor(path);
  return (
    <header className="pg-topbar">
      <nav aria-label="Breadcrumb" className="pg-crumbs">
        <span>{current?.group.label ?? "Console"}</span>
        <ChevronRight aria-hidden />
        <span aria-current="page">{current?.item.label ?? "Overview"}</span>
      </nav>
      <div className="pg-topbar-right">
        <LiveIndicator />
        <AlertsButton />
      </div>
    </header>
  );
}
