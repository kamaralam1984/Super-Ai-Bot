import { Outlet, Navigate, NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, ShieldCheck, LogOut, Loader2, GraduationCap, Plug, MessageSquare, Radar, HardDriveDownload, Blocks, BadgeCheck, Settings } from "lucide-react";
import { AmbientCanvas } from "../../components/AmbientCanvas";
import { ThemeToggle } from "../../components/ThemeToggle";
import { useAdminSession } from "../../hooks/useAdminSession";

// Grows by one entry per Dashboard: <X> page task as it's built — kept as
// a single source of truth so a page is never link-able before it
// actually exists.
const NAV_ITEMS = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/dashboard/training", label: "Website & Training", icon: GraduationCap },
  { to: "/dashboard/connectors", label: "Connectors", icon: Plug },
  { to: "/dashboard/chat", label: "Chat", icon: MessageSquare },
  { to: "/dashboard/monitoring", label: "Monitoring", icon: Radar },
  { to: "/dashboard/backups", label: "Backups", icon: HardDriveDownload },
  { to: "/dashboard/plugins", label: "Plugins", icon: Blocks },
  { to: "/dashboard/license", label: "License", icon: BadgeCheck },
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
  { to: "/dashboard/permissions", label: "AI Data Permissions", icon: ShieldCheck },
];

export function DashboardLayout() {
  const { state, installation, logout } = useAdminSession();
  const location = useLocation();

  if (state === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground text-ink-muted">
        <Loader2 size={20} className="animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (state === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-ground">
      <AmbientCanvas />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgb(var(--accent)/0.08),transparent)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border/70 p-4 sm:flex">
          <div className="mb-6 flex items-center gap-2.5 px-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span className="font-display text-[14px] font-semibold tracking-tight text-ink">KVL Dashboard</span>
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? "bg-accent/10 text-accent" : "text-ink-muted hover:bg-surface-raised/60 hover:text-ink"
                  }`
                }
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto space-y-2 border-t border-border/70 pt-3">
            {installation && (
              <p className="truncate px-1 text-xs text-ink-faint" title={installation.websiteUrl}>
                {installation.websiteName}
              </p>
            )}
            <button
              type="button"
              onClick={() => logout()}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-raised/60 hover:text-critical"
            >
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border/70 px-5 py-3 sm:px-7">
            <span className="font-display text-sm font-medium text-ink-muted">Admin Dashboard</span>
            <ThemeToggle />
          </header>

          <main className="min-w-0 flex-1 px-5 py-6 sm:px-7">
            <Outlet context={{ installation }} />
          </main>
        </div>
      </div>
    </div>
  );
}
