// Scheduled backups — reuses Phase 10's CronRuntime (monitor/schedule/
// cronScheduler.ts) rather than inventing a second in-process scheduler.
// Unlike ScanSchedule (one row per schedule, many possible schedules),
// there is exactly one backup schedule for the whole installation
// (BACKUP_SCHEDULE_CRON in .env), so this registers a single fixed
// scheduleId with its own CronRuntime instance instead of sharing
// monitor/monitorOrchestrator.service.ts's ScanSchedule-keyed runtime.

import { CronRuntime, validateCronExpression } from "../../monitor/schedule/cronScheduler";
import { runBackup, pruneOldBackups } from "./backupService";
import { getActiveInstallationId } from "../../scanner/scanRecord.service";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";

const BACKUP_SCHEDULE_ID = "backup-schedule";
const DEFAULT_CRON_EXPRESSION = "0 3 * * *";

let backupRuntime: CronRuntime | null = null;

async function executeScheduledBackup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  try {
    const installationId = await getActiveInstallationId(databaseUrl);
    if (!installationId) return;
    await runBackup(databaseUrl, installationId, "SCHEDULED", "scheduled");
    const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? "14");
    await pruneOldBackups(databaseUrl, installationId, retentionDays);
  } catch (err) {
    logEvent({ component: "deployment-backup", message: "Scheduled backup failed", status: "error", error: formatError(err) });
  }
}

/** Called once at process boot (index.ts) — registers the recurring backup schedule from BACKUP_SCHEDULE_CRON (default: daily at 03:00 UTC). A malformed expression is logged and left unscheduled rather than crashing boot over an optional feature. */
export function registerBackupSchedule(): void {
  const expression = process.env.BACKUP_SCHEDULE_CRON?.trim() || DEFAULT_CRON_EXPRESSION;
  const validation = validateCronExpression(expression);
  if (!validation.valid) {
    logEvent({ component: "deployment-backup", message: `Invalid BACKUP_SCHEDULE_CRON "${expression}" — scheduled backups disabled`, status: "error", error: validation.errorMessage });
    return;
  }
  if (!backupRuntime) {
    backupRuntime = new CronRuntime(() => executeScheduledBackup());
  }
  backupRuntime.register(BACKUP_SCHEDULE_ID, expression);
  logEvent({ component: "deployment-backup", message: `Scheduled backups registered: "${expression}" (UTC)`, status: "info" });
}
