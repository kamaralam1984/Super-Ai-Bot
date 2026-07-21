import { useEffect, useState, type ReactNode } from "react";
import { Radar, Bell, CalendarClock, ListChecks, Loader2 } from "lucide-react";
import { StepHeader } from "../../components/StepHeader";
import { PrimaryButton } from "../../components/PrimaryButton";
import { api } from "../../lib/api";
import type { ComparisonReportSummary, NotificationRecord, ScanScheduleRecord, BackgroundJobRecord } from "../../lib/dashboardTypes";

function Section({ icon: Icon, title, children }: { icon: typeof Radar; title: string; children: ReactNode }) {
  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
        <Icon size={15} aria-hidden="true" /> {title}
      </div>
      {children}
    </div>
  );
}

export function MonitoringPage() {
  const [reports, setReports] = useState<ComparisonReportSummary[] | null>(null);
  const [notifications, setNotifications] = useState<NotificationRecord[] | null>(null);
  const [schedules, setSchedules] = useState<ScanScheduleRecord[] | null>(null);
  const [jobs, setJobs] = useState<BackgroundJobRecord[] | null>(null);

  useEffect(() => {
    api.monitor.listReports().then(setReports).catch(() => setReports([]));
    api.monitor.listNotifications().then(setNotifications).catch(() => setNotifications([]));
    api.monitor.listSchedules().then(setSchedules).catch(() => setSchedules([]));
    api.monitor.listJobs().then(setJobs).catch(() => setJobs([]));
  }, []);

  async function markRead(id: string) {
    await api.monitor.markNotificationRead(id);
    setNotifications((prev) => prev?.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) ?? null);
  }

  async function toggleSchedule(id: string, enabled: boolean) {
    await api.monitor.setScheduleEnabled(id, enabled);
    setSchedules((prev) => prev?.map((s) => (s.id === id ? { ...s, enabled } : s)) ?? null);
  }

  async function removeSchedule(id: string) {
    await api.monitor.deleteSchedule(id);
    setSchedules((prev) => prev?.filter((s) => s.id !== id) ?? null);
  }

  return (
    <div className="max-w-3xl">
      <StepHeader icon={Radar} title="Monitoring" subtitle="Website change detection, notifications, scheduled recrawls, and background jobs (Phase 10)." />

      <Section icon={Bell} title="Notifications">
        {!notifications && <Loader2 size={15} className="animate-spin text-ink-muted" aria-hidden="true" />}
        {notifications && notifications.length === 0 && <p className="text-sm text-ink-muted">No notifications yet.</p>}
        {notifications && notifications.length > 0 && (
          <ul className="space-y-2">
            {notifications.slice(0, 15).map((n) => (
              <li key={n.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${n.readAt ? "border-border bg-surface/60 text-ink-muted" : "border-accent/25 bg-accent/5 text-ink"}`}>
                <span className="flex-1 truncate">{n.title}</span>
                {!n.readAt && (
                  <PrimaryButton variant="ghost" onClick={() => markRead(n.id)}>Mark read</PrimaryButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={ListChecks} title="Knowledge comparison reports">
        {!reports && <Loader2 size={15} className="animate-spin text-ink-muted" aria-hidden="true" />}
        {reports && reports.length === 0 && <p className="text-sm text-ink-muted">No comparison reports yet — these are generated automatically after each training run.</p>}
        {reports && reports.length > 0 && (
          <ul className="space-y-2">
            {reports.slice(0, 10).map((r) => (
              <li key={r.crawlJobId} className="rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm text-ink">
                <span className="data-value">{r.crawlJobId.slice(0, 12)}…</span> — {new Date(r.generatedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={CalendarClock} title="Scheduled recrawls">
        {!schedules && <Loader2 size={15} className="animate-spin text-ink-muted" aria-hidden="true" />}
        {schedules && schedules.length === 0 && <p className="text-sm text-ink-muted">No scheduled recrawls configured.</p>}
        {schedules && schedules.length > 0 && (
          <ul className="space-y-2">
            {schedules.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm text-ink">
                <span className="flex-1 truncate">{s.label ?? s.cronExpression} <span className="text-xs text-ink-faint">({s.cronExpression})</span></span>
                <PrimaryButton variant="ghost" onClick={() => toggleSchedule(s.id, !s.enabled)}>{s.enabled ? "Disable" : "Enable"}</PrimaryButton>
                <PrimaryButton variant="ghost" onClick={() => removeSchedule(s.id)}>Delete</PrimaryButton>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={ListChecks} title="Background jobs">
        {!jobs && <Loader2 size={15} className="animate-spin text-ink-muted" aria-hidden="true" />}
        {jobs && jobs.length === 0 && <p className="text-sm text-ink-muted">No background jobs recorded yet.</p>}
        {jobs && jobs.length > 0 && (
          <ul className="space-y-2">
            {jobs.slice(0, 15).map((j) => (
              <li key={j.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm text-ink">
                <span className="flex-1">{j.type}</span>
                <span className="text-xs text-ink-faint">{j.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
