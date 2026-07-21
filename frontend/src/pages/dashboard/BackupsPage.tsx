import { useEffect, useState } from "react";
import { HardDriveDownload, Loader2, Info } from "lucide-react";
import { StepHeader } from "../../components/StepHeader";
import { StatusIcon } from "../../components/StatusIcon";
import { PrimaryButton } from "../../components/PrimaryButton";
import { api } from "../../lib/api";
import type { BackupRecordRow } from "../../lib/dashboardTypes";

const STATUS_TO_CHECK: Record<BackupRecordRow["status"], "pass" | "warn" | "fail"> = {
  COMPLETED: "pass",
  IN_PROGRESS: "warn",
  FAILED: "fail",
};

function formatBytes(bytes: string | null): string {
  if (!bytes) return "—";
  const mb = Number(bytes) / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)}GB` : `${mb.toFixed(1)}MB`;
}

export function BackupsPage() {
  const [backups, setBackups] = useState<BackupRecordRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");

  function load() {
    api.deployment.listBackups().then(setBackups).catch(() => setBackups([]));
  }
  useEffect(load, []);

  async function createBackup() {
    setCreating(true);
    try {
      await api.deployment.createBackup(label || undefined);
      setLabel("");
      load();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <StepHeader icon={HardDriveDownload} title="Backups" subtitle="Database, Redis, and every data directory — see docs/BACKUP_GUIDE.md." />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Optional label"
          className="rounded-lg border border-border bg-surface-raised/60 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <PrimaryButton onClick={createBackup} loading={creating}>Create backup now</PrimaryButton>
      </div>

      <p className="mb-5 flex items-start gap-1.5 text-xs text-ink-muted">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Restoring a backup is a destructive, host-level operation (<code className="data-value">deploy/scripts/restore.sh</code>) — run it from the server itself, not from this dashboard. See docs/BACKUP_GUIDE.md.
        </span>
      </p>

      {!backups && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…
        </div>
      )}
      {backups && backups.length === 0 && <p className="text-sm text-ink-muted">No backups yet.</p>}
      {backups && backups.length > 0 && (
        <ul className="space-y-2">
          {backups.map((b) => (
            <li key={b.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm">
              <StatusIcon status={STATUS_TO_CHECK[b.status]} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-ink">{b.filePath}</p>
                <p className="text-xs text-ink-muted">{b.type} · {formatBytes(b.sizeBytes)} · {new Date(b.createdAt).toLocaleString()}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
