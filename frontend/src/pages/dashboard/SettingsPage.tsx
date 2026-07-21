import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Settings, Loader2, Info } from "lucide-react";
import { StepHeader } from "../../components/StepHeader";
import { PrimaryButton } from "../../components/PrimaryButton";
import { api, type AdminInstallation } from "../../lib/api";
import type { NotificationSettingsInput } from "../../lib/dashboardTypes";

const EMPTY_SETTINGS: NotificationSettingsInput = { emailEnabled: false, emailAddress: null, webhookEnabled: false, webhookUrl: null, enabledEmailTypes: [], enabledWebhookTypes: [] };

export function SettingsPage() {
  const { installation } = useOutletContext<{ installation: AdminInstallation | null }>();
  const [settings, setSettings] = useState<NotificationSettingsInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!installation) return;
    api.monitor
      .getNotificationSettings(installation.id)
      .then((s) => setSettings(s ?? EMPTY_SETTINGS))
      .catch(() => setSettings(EMPTY_SETTINGS));
  }, [installation]);

  async function save() {
    if (!installation || !settings) return;
    setSaving(true);
    setSaved(false);
    try {
      await api.monitor.putNotificationSettings({ installationId: installation.id, ...settings });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <StepHeader icon={Settings} title="Settings" subtitle="Notification channels for website-change alerts (Phase 10)." />

      {!settings && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…
        </div>
      )}

      {settings && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface/60 p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" checked={settings.emailEnabled} onChange={(e) => setSettings({ ...settings, emailEnabled: e.target.checked })} />
              Email notifications
            </label>
            <input
              type="email"
              value={settings.emailAddress ?? ""}
              onChange={(e) => setSettings({ ...settings, emailAddress: e.target.value || null })}
              placeholder="admin@example.com"
              disabled={!settings.emailEnabled}
              className="mt-2 w-full rounded-lg border border-border bg-surface-raised/60 px-3 py-2 text-sm text-ink placeholder:text-ink-faint disabled:opacity-40 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
            <p className="mt-1.5 text-xs text-ink-faint">Requires SMTP_HOST etc. set in the server's .env (see docs/AUTO_UPDATE_ENGINE.md).</p>
          </div>

          <div className="rounded-lg border border-border bg-surface/60 p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" checked={settings.webhookEnabled} onChange={(e) => setSettings({ ...settings, webhookEnabled: e.target.checked })} />
              Webhook notifications
            </label>
            <input
              type="url"
              value={settings.webhookUrl ?? ""}
              onChange={(e) => setSettings({ ...settings, webhookUrl: e.target.value || null })}
              placeholder="https://example.com/webhook"
              disabled={!settings.webhookEnabled}
              className="mt-2 w-full rounded-lg border border-border bg-surface-raised/60 px-3 py-2 text-sm text-ink placeholder:text-ink-faint disabled:opacity-40 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          <PrimaryButton onClick={save} loading={saving}>Save</PrimaryButton>
          {saved && <span className="ml-2 text-xs text-success">Saved.</span>}
        </div>
      )}

      <p className="mt-8 flex items-start gap-1.5 text-xs text-ink-faint">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          LLM provider and SMTP server credentials are server-side <code className="data-value">.env</code> values, not editable from this dashboard — see docs/CHAT_ENGINE.md and docs/ADMINISTRATOR_GUIDE.md.
        </span>
      </p>
    </div>
  );
}
