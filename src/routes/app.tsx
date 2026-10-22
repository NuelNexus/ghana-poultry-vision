import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Sidebar, TopBar, navItemFor } from "@/components/Sidebar";
import { Skeleton } from "@/components/ui-kit";
import { ThemeProvider } from "@/components/ThemeProvider";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

/**
 * Console shell. All styling lives in src/styles.css (".pg-console" scope,
 * shell classes .pg-side / .pg-main / .pg-topbar / .pg-content). No global
 * overrides here: pages style themselves with tokens + ui-kit components.
 */
function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  // Per-route document title: "Houses · PoultryGrid".
  useEffect(() => {
    const cur = navItemFor(path);
    document.title = cur ? `${cur.item.title ?? cur.item.label} · PoultryGrid` : "PoultryGrid";
  }, [path]);

  // ThemeProvider puts the console scope + the user's theme on <html> (so
  // portals, dialogs and toasts follow it too), sets meta theme-color, and
  // undoes all of it when leaving /app.
  return (
    <ThemeProvider userId={user?.id ?? null}>
      {loading || !user ? <ShellLoading /> : <Shell />}
    </ThemeProvider>
  );
}

function Shell() {
  return (
    <div className="pg-console pg-shell">
      <a href="#main" className="pg-skip">
        Skip to content
      </a>
      <Sidebar />
      <div className="pg-main">
        <TopBar />
        <main id="main" tabIndex={-1} className="pg-content outline-none">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function ShellLoading() {
  return (
    <div className="pg-console pg-boot" role="status" aria-label="Loading console">
      <div className="pg-boot-side" aria-hidden>
        <Skeleton className="h-7 w-7 rounded-md" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
          ))}
        </div>
      </div>
      <div className="pg-boot-main" aria-hidden>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}
