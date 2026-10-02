import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return <div className="pg-shell-loading">Loading…</div>;
  }

  return (
    <div className="pg-shell">
      <Sidebar />
      <main className="pg-main">
        <div className="pg-main-inner">
          <Outlet />
        </div>
      </main>
      <style>{shellCss}</style>
    </div>
  );
}

const shellCss = `
.pg-shell-loading {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: #000; color: #fff; font-family: 'Nunito', sans-serif;
}
.pg-shell {
  --pg-bg: #fff;
  --pg-fg: #111;
  --pg-muted: rgba(17,17,17,.6);
  --pg-border: #000;
  --pg-card: #fff;
  --pg-accent: #111;
  min-height: 100vh;
  background: var(--pg-bg);
  color: var(--pg-fg);
  font-family: 'Nunito', system-ui, sans-serif;
  position: relative;
}
.pg-shell *, .pg-shell *::before, .pg-shell *::after { box-sizing: border-box; }

/* Sidebar */
.pg-sidebar {
  position: fixed; top: 0; left: 0; width: 180px; height: 100vh;
  display: flex; flex-direction: column; justify-content: space-between;
  border-right: 1px solid var(--pg-border);
  padding: 14px 0 12px;
  background: var(--pg-bg);
  z-index: 30;
}
.pg-user { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 8px 18px; }
.pg-avatar {
  width: 64px; height: 64px; border-radius: 50%;
  border: 1px solid var(--pg-border);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 1.1rem; color: var(--pg-fg);
  letter-spacing: .05em;
}
.pg-user p {
  font-size: .85rem; color: var(--pg-fg); font-weight: 500;
  text-align: center; word-break: break-word; line-height: 1.2; margin: 0;
}
.pg-navlist { list-style: none; padding: 0; margin: 0; }
.pg-navitem a, .pg-logout {
  display: flex; align-items: center; justify-content: flex-start; gap: 12px;
  color: var(--pg-fg); text-decoration: none;
  font-size: .9rem; font-weight: 500;
  padding: 10px 14px; margin: 2px 8px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid transparent;
  width: calc(100% - 16px);
  cursor: pointer;
  font-family: inherit;
  transition: background .15s, border-color .15s;
}
.pg-navitem a:hover, .pg-logout:hover {
  background: rgba(0,0,0,.04);
  border-color: rgba(0,0,0,.35);
}
.pg-navitem.pg-active a {
  background: #000; color: #fff;
  border-color: #000;
}
.pg-nav-icon { width: 18px; height: 18px; flex-shrink: 0; }
.pg-nav-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Main */
.pg-main {
  margin-left: 180px;
  min-height: 100vh;
}
.pg-main-inner {
  max-width: 1400px;
  padding: 28px 28px 40px;
}

/* Apply white-bordered card aesthetic to common UI inside main */
.pg-main .bg-card,
.pg-main [class*="border"] {
  border-color: var(--pg-border) !important;
}
.pg-main .bg-card,
.pg-main .bg-background,
.pg-main .bg-popover,
.pg-main .bg-muted,
.pg-main .bg-secondary {
  background: var(--pg-card) !important;
  color: var(--pg-fg) !important;
}
.pg-main .text-muted-foreground { color: var(--pg-muted) !important; }
.pg-main h1, .pg-main h2, .pg-main h3, .pg-main h4 { color: var(--pg-fg); }

/* Responsive */
@media (max-width: 1500px) {
  .pg-sidebar { width: 76px; }
  .pg-nav-text { display: none; }
  .pg-navitem a, .pg-logout { justify-content: center; padding: 12px 0; }
  .pg-main { margin-left: 76px; }
}
@media (max-width: 768px) {
  .pg-sidebar { width: 56px; overflow-y: auto; }
  .pg-avatar { width: 40px; height: 40px; font-size: .85rem; }
  .pg-user p { display: none; }
  .pg-navitem a, .pg-logout { margin: 2px 4px; width: calc(100% - 8px); }
  .pg-main { margin-left: 56px; }
  .pg-main-inner { padding: 20px 16px 32px; }
}
`;
