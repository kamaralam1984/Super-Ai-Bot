// Backup Manager — pure planning logic (naming, retention). No Prisma, no
// filesystem, no child_process — see backupService.ts for the impure
// orchestration this feeds into, matching every other domain's
// "engines are pure, exactly one service touches the outside world"
// discipline established since Phase 2.

/** Every runtime directory that holds real, irreplaceable customer/operator data — see backend/src/config/paths.ts's RUNTIME_DIRECTORIES for the full set this is a considered subset of. Deliberately excludes: `models` (re-downloadable ML model/OCR-language-pack caches, not user data — see embed/embeddings.ts and scanner/ocr/ocrEngine.ts), `cache`/`temp` (transient by definition), and `backups` itself (never archive a backup into a backup). */
export const BACKUP_INCLUDED_DIRECTORIES = ["storage", "knowledge", "embeddings", "config", "uploads", "plugins", "connectors", "logs"] as const;

export type BackupComponent = "database" | "redis" | (typeof BACKUP_INCLUDED_DIRECTORIES)[number];

export const ALL_BACKUP_COMPONENTS: BackupComponent[] = ["database", "redis", ...BACKUP_INCLUDED_DIRECTORIES];

/** Filesystem-safe, sortable, self-describing filename — sortable-by-name is what lets `listBackups` order without a DB round trip being strictly required, and self-describing means an operator staring at a directory listing (e.g. during disaster recovery, DB unreachable) can still tell backups apart. */
export function buildBackupFileName(label: string | null, createdAt: Date): string {
  const timestamp = createdAt.toISOString().replace(/[:.]/g, "-");
  const safeLabel = (label ?? "manual").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "manual";
  return `kvl-backup-${timestamp}-${safeLabel}.tar.gz`;
}

export interface PrunableBackup {
  id: string;
  createdAt: Date;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
}

/**
 * Which backups a retention sweep should delete — anything COMPLETED and
 * older than `retentionDays`, except the single most recent COMPLETED
 * backup is always kept regardless of age. Without that floor, a
 * misconfigured near-zero retention window (or a long gap between
 * successful backups) could prune every backup down to zero, leaving
 * nothing to restore from — the one scenario a backup system must never
 * produce. FAILED/IN_PROGRESS rows are never auto-deleted here (a stuck
 * IN_PROGRESS row signals a crash worth an operator's attention, not
 * silent cleanup; see restore/backupCli for manual cleanup).
 */
export function selectBackupsToPrune(backups: PrunableBackup[], retentionDays: number, now: Date = new Date()): PrunableBackup[] {
  const completed = backups.filter((b) => b.status === "COMPLETED").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (completed.length <= 1) return [];

  const mostRecent = completed[0];
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return completed.filter((b) => b.id !== mostRecent.id && b.createdAt.getTime() < cutoff);
}
