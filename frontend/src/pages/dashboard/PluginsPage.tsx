import { useEffect, useState } from "react";
import { Blocks, Loader2, Info } from "lucide-react";
import { StepHeader } from "../../components/StepHeader";
import { StatusIcon } from "../../components/StatusIcon";
import { PrimaryButton } from "../../components/PrimaryButton";
import { api } from "../../lib/api";
import type { PluginRow } from "../../lib/dashboardTypes";

const STATUS_TO_CHECK: Record<PluginRow["status"], "pass" | "warn" | "fail"> = {
  ENABLED: "pass",
  DISABLED: "warn",
  ERROR: "fail",
};

export function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginRow[] | null>(null);
  const [discoverable, setDiscoverable] = useState<string[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    api.deployment.listPlugins().then(setPlugins).catch(() => setPlugins([]));
    api.deployment.discoverPlugins().then(setDiscoverable).catch(() => setDiscoverable([]));
  }
  useEffect(load, []);

  async function install(name: string) {
    setBusyId(name);
    try {
      await api.deployment.installPlugin(name);
      load();
    } finally {
      setBusyId(null);
    }
  }
  async function toggle(id: string, enabled: boolean) {
    setBusyId(id);
    try {
      await (enabled ? api.deployment.enablePlugin(id) : api.deployment.disablePlugin(id));
      load();
    } finally {
      setBusyId(null);
    }
  }
  async function remove(id: string) {
    setBusyId(id);
    try {
      await api.deployment.removePlugin(id);
      load();
    } finally {
      setBusyId(null);
    }
  }

  const installedNames = new Set(plugins?.map((p) => p.name));
  const notInstalled = discoverable?.filter((name) => !installedNames.has(name)) ?? [];

  return (
    <div className="max-w-3xl">
      <StepHeader icon={Blocks} title="Plugins" subtitle="Installed plugins are always disabled by default (least-privilege)." />

      <p className="mb-5 flex items-start gap-1.5 text-xs text-ink-muted">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        Plugin code is never executed by this platform yet — this manages registration, permissions, and lifecycle only. See docs/DEPLOYMENT.md's Plugin Management section.
      </p>

      {!plugins && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…
        </div>
      )}
      {plugins && plugins.length === 0 && <p className="text-sm text-ink-muted">No plugins installed yet.</p>}
      {plugins && plugins.length > 0 && (
        <ul className="mb-6 space-y-2">
          {plugins.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm">
              <StatusIcon status={STATUS_TO_CHECK[p.status]} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-ink">{p.name} <span className="text-xs text-ink-faint">v{p.version}</span></p>
                {p.errorMessage && <p className="truncate text-xs text-critical">{p.errorMessage}</p>}
              </div>
              <PrimaryButton variant="ghost" onClick={() => toggle(p.id, p.status !== "ENABLED")} loading={busyId === p.id}>
                {p.status === "ENABLED" ? "Disable" : "Enable"}
              </PrimaryButton>
              <PrimaryButton variant="ghost" onClick={() => remove(p.id)} loading={busyId === p.id}>Remove</PrimaryButton>
            </li>
          ))}
        </ul>
      )}

      {notInstalled.length > 0 && (
        <>
          <div className="mb-3 text-sm font-medium text-ink">Discovered, not yet installed</div>
          <ul className="space-y-2">
            {notInstalled.map((name) => (
              <li key={name} className="flex items-center gap-3 rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm text-ink">
                <span className="flex-1">{name}</span>
                <PrimaryButton onClick={() => install(name)} loading={busyId === name}>Install</PrimaryButton>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
