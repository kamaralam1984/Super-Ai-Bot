// Backup Manager — the impure orchestration edge: shells out to pg_dump
// (Postgres' own dump tool — reimplementing its binary/custom dump format
// would be pure risk for zero benefit) and redis-cli --rdb (same
// reasoning for Redis' RDB format), then tars the runtime directories
// that hold real customer/operator data (see backupPlanner.ts's
// BACKUP_INCLUDED_DIRECTORIES) into one archive under `backups/`.
// Composes with BackupRecordService (Prisma) and backupPlanner.ts (pure
// naming/retention decisions) — matches every other domain's
// engine-orchestrator split.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { APP_ROOT, BACKUPS_DIR, TEMP_DIR } from "../../config/paths";
import { BackupRecordService, type BackupRecordRow } from "./backupRecord.service";
import { buildBackupFileName, selectBackupsToPrune, BACKUP_INCLUDED_DIRECTORIES, ALL_BACKUP_COMPONENTS } from "./backupPlanner";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";
import { recordAuditEvent } from "../../knowledge/security/auditLog";

const execFileAsync = promisify(execFile);

export interface BackupResult {
  id: string;
  filePath: string;
  sizeBytes: number;
  checksumSha256: string;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fsSync.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

/**
 * Runs one full backup: database + redis + every directory in
 * BACKUP_INCLUDED_DIRECTORIES, into a single tar.gz under `backups/`.
 * Any component that's genuinely absent (e.g. no Redis data yet on a
 * brand-new install) is skipped, not treated as a failure — but a
 * component that *should* exist and errors (pg_dump failing against a
 * reachable database) fails the whole backup rather than silently
 * shipping a partial, misleadingly-"COMPLETED" archive.
 */
export async function runBackup(databaseUrl: string, installationId: string, type: "MANUAL" | "SCHEDULED" | "PRE_UPDATE", label: string | null): Promise<BackupResult> {
  const records = new BackupRecordService(databaseUrl);
  const createdAt = new Date();
  const fileName = buildBackupFileName(label, createdAt);
  const finalPath = path.join(BACKUPS_DIR, fileName);
  const stagingDir = path.join(TEMP_DIR, `backup-staging-${crypto.randomUUID()}`);

  let recordId: string | null = null;
  try {
    recordId = await records.createInProgress(installationId, type, label, fileName);
    await fs.mkdir(stagingDir, { recursive: true, mode: 0o750 });
    await fs.mkdir(BACKUPS_DIR, { recursive: true, mode: 0o750 });

    const included: string[] = [];
    const stagedFiles: string[] = [];

    logEvent({ component: "deployment-backup", message: `Dumping database for backup ${fileName}...`, status: "info" });
    const dbDumpPath = path.join(stagingDir, "database.dump");
    await execFileAsync("pg_dump", ["--format=custom", `--file=${dbDumpPath}`, databaseUrl], { timeout: 10 * 60 * 1000 });
    stagedFiles.push("database.dump");
    included.push("database");

    if (process.env.REDIS_URL) {
      logEvent({ component: "deployment-backup", message: `Dumping Redis for backup ${fileName}...`, status: "info" });
      const redisDumpPath = path.join(stagingDir, "redis.rdb");
      try {
        await execFileAsync("redis-cli", ["-u", process.env.REDIS_URL, "--rdb", redisDumpPath], { timeout: 5 * 60 * 1000 });
        stagedFiles.push("redis.rdb");
        included.push("redis");
      } catch (err) {
        // Redis is cache/session-adjacent state, not the source of truth
        // for anything this product can't function without — unlike a
        // failed pg_dump, a failed Redis dump is logged and the backup
        // continues without it, rather than aborting entirely.
        logEvent({ component: "deployment-backup", message: "Redis dump failed — continuing backup without it", status: "warn", error: formatError(err) });
      }
    }

    const existingDirs: string[] = [];
    for (const dir of BACKUP_INCLUDED_DIRECTORIES) {
      const dirPath = path.join(APP_ROOT, dir);
      if (fsSync.existsSync(dirPath)) {
        existingDirs.push(dir);
        included.push(dir);
      }
    }

    logEvent({ component: "deployment-backup", message: `Archiving ${fileName} (${included.join(", ")})...`, status: "info" });
    const tarArgs = ["-czf", finalPath, "-C", stagingDir, ...stagedFiles];
    if (existingDirs.length > 0) {
      tarArgs.push("-C", APP_ROOT, ...existingDirs);
    }
    await execFileAsync("tar", tarArgs, { timeout: 20 * 60 * 1000, maxBuffer: 1024 * 1024 * 64 });

    const stat = await fs.stat(finalPath);
    const checksum = await sha256File(finalPath);
    await records.markCompleted(recordId, stat.size, checksum, included);

    logEvent({ component: "deployment-backup", message: `Backup complete: ${fileName} (${(stat.size / 1024 / 1024).toFixed(1)}MB, ${included.length}/${ALL_BACKUP_COMPONENTS.length} components)`, status: "success" });
    recordAuditEvent({ type: "deployment_backup_created", detail: `${fileName} (${type}, ${(stat.size / 1024 / 1024).toFixed(1)}MB)`, component: "deployment-backup" });
    return { id: recordId, filePath: fileName, sizeBytes: stat.size, checksumSha256: checksum };
  } catch (err) {
    const message = formatError(err);
    logEvent({ component: "deployment-backup", message: `Backup ${fileName} failed`, status: "error", error: message });
    recordAuditEvent({ type: "deployment_backup_failed", detail: `${fileName}: ${message}`, component: "deployment-backup" });
    if (recordId) await records.markFailed(recordId, message);
    await fs.rm(finalPath, { force: true }).catch(() => undefined);
    throw err;
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    await records.close();
  }
}

export async function listBackups(databaseUrl: string, installationId: string): Promise<BackupRecordRow[]> {
  const records = new BackupRecordService(databaseUrl);
  try {
    return await records.list(installationId);
  } finally {
    await records.close();
  }
}

/** Applies the retention policy: deletes both the DB row and the on-disk archive for every backup selectBackupsToPrune identifies. Returns how many were pruned. */
export async function pruneOldBackups(databaseUrl: string, installationId: string, retentionDays: number): Promise<number> {
  const records = new BackupRecordService(databaseUrl);
  try {
    const all = await records.list(installationId, 500);
    const toPrune = selectBackupsToPrune(all, retentionDays);
    for (const backup of toPrune) {
      const full = await records.get(backup.id);
      if (full) {
        await fs.rm(path.join(BACKUPS_DIR, full.filePath), { force: true }).catch(() => undefined);
      }
      await records.delete(backup.id);
    }
    if (toPrune.length > 0) {
      logEvent({ component: "deployment-backup", message: `Pruned ${toPrune.length} backup(s) older than ${retentionDays} days`, status: "info" });
    }
    return toPrune.length;
  } finally {
    await records.close();
  }
}
