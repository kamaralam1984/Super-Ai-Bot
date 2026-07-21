import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Plug, Loader2, RefreshCw } from "lucide-react";
import { StepHeader } from "../../components/StepHeader";
import { StatusIcon } from "../../components/StatusIcon";
import { PrimaryButton } from "../../components/PrimaryButton";
import { api, type AdminInstallation } from "../../lib/api";
import type { ConnectorRecord } from "../../lib/dashboardTypes";

const STATUS_TO_CHECK: Record<ConnectorRecord["status"], "pass" | "warn" | "fail"> = {
  CONNECTED: "pass",
  PENDING: "warn",
  DEGRADED: "warn",
  DISCONNECTED: "fail",
  ERROR: "fail",
};

export function ConnectorsPage() {
  const { installation } = useOutletContext<{ installation: AdminInstallation | null }>();
  const [connectors, setConnectors] = useState<ConnectorRecord[] | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!installation) return;
    api.connector
      .list(installation.id)
      .then(setConnectors)
      .catch(() => setConnectors([]));
  }, [installation]);

  useEffect(() => load(), [load]);

  async function runHealthCheck(id: string) {
    setCheckingId(id);
    try {
      await api.connector.healthCheck(id);
      load();
    } finally {
      setCheckingId(null);
    }
  }

  return (
    <div className="max-w-3xl">
      <StepHeader icon={Plug} title="Connectors" subtitle="Backend systems this installation is authorized to read from (Phase 5/9)." />

      {!connectors && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…
        </div>
      )}

      {connectors && connectors.length === 0 && (
        <p className="text-sm text-ink-muted">
          No connectors configured yet. Connectors are set up via <code className="data-value">POST /api/connector/start</code> during a website scan/setup flow — see docs/SMART_CONNECTOR.md.
        </p>
      )}

      {connectors && connectors.length > 0 && (
        <ul className="space-y-2">
          {connectors.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
              <StatusIcon status={STATUS_TO_CHECK[c.status]} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{c.name} <span className="text-xs text-ink-faint">({c.connectorType})</span></p>
                <p className="truncate text-xs text-ink-muted">{c.baseUrl} · priority {c.priority}{c.healthScore !== null ? ` · health ${c.healthScore}` : ""}</p>
                {c.lastErrorMessage && <p className="truncate text-xs text-critical">{c.lastErrorMessage}</p>}
              </div>
              <PrimaryButton variant="ghost" onClick={() => runHealthCheck(c.id)} loading={checkingId === c.id}>
                <RefreshCw size={13} aria-hidden="true" /> Check
              </PrimaryButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
