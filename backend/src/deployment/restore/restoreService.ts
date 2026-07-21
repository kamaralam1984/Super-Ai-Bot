// Restore Manager — the impure orchestration edge for restoring a
// Backup Manager archive (backup/backupService.ts). Handles Postgres
// (pg_restore) and every runtime directory this backend container has
// mounted (storage/knowledge/embeddings/config/uploads/plugins/
// connectors/logs) directly, since both are reachable from inside this
// container exactly like backupService.ts's archiving of them was.
//
// Redis is deliberately NOT restored here — see deploy/scripts/restore.sh
// for why (this container has no access to the `redis_data` volume, by
// design; bridging two Docker volumes requires real Docker-host access,
// which this process intentionally doesn't have — the same zero-trust
// reasoning as nginx's reload loop and Update Manager's doc comment).
// The extracted redis.rdb is staged where restore.sh can pick it up.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { APP_ROOT, BACKUPS_DIR, TEMP_DIR } from "../../config/paths";
import { BACKUP_INCLUDED_DIRECTORIES } from "../backup/backupPlanner";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";
import { recordAuditEvent } from "../../knowledge/security/auditLog";

const execFileAsync = promisify(execFile);

export interface RestorePlan {
  fileName: string;
  restoreDatabase: boolean;
  restoreRedis: boolean;
  restoreDirectories: string[];
}

export interface RestoreResult {
  fileName: string;
  restoredDatabase: boolean;
  redisRdbStagedAt: string | null;
  restoredDirectories: string[];
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

/** Throws if the archive's actual checksum doesn't match the one recorded at backup time — a corrupted or tampered archive must never be silently restored from. `null` expectedChecksum (the BackupRecord couldn't be looked up, e.g. because the database is itself what's broken) skips verification with a loud warning rather than blocking disaster recovery entirely. */
export async function verifyBackupIntegrity(fileName: string, expectedChecksum: string | null): Promise<void> {
  const filePath = path.join(BACKUPS_DIR, fileName);
  if (!fsSync.existsSync(filePath)) {
    throw new Error(`Backup file not found: ${filePath}`);
  }
  if (!expectedChecksum) {
    logEvent({ component: "deployment-restore", message: `No recorded checksum available for ${fileName} — restoring without integrity verification`, status: "warn" });
    return;
  }
  const actual = await sha256File(filePath);
  if (actual !== expectedChecksum) {
    throw new Error(`Checksum mismatch for ${fileName}: expected ${expectedChecksum}, got ${actual}. The archive may be corrupted or tampered with — refusing to restore.`);
  }
}

/**
 * Restores a backup archive: extracts it, pg_restores the database
 * (`--clean --if-exists` — drops existing objects first, since a restore
 * is meant to fully replace current state, not merge with it), copies
 * every archived runtime directory back into place (replacing current
 * contents), and stages redis.rdb (if present) for restore.sh's
 * volume-bridging step. The caller (runRestore.ts CLI, invoked only via
 * `docker compose run` with the real backend service stopped — see
 * restore.sh) is responsible for ensuring nothing else is writing to
 * these directories concurrently; this function does not itself pause
 * traffic.
 */
export async function restoreFromArchive(databaseUrl: string, fileName: string): Promise<RestoreResult> {
  const archivePath = path.join(BACKUPS_DIR, fileName);
  const stagingDir = path.join(TEMP_DIR, `restore-staging-${crypto.randomUUID()}`);
  await fs.mkdir(stagingDir, { recursive: true, mode: 0o750 });

  try {
    logEvent({ component: "deployment-restore", message: `Extracting ${fileName}...`, status: "info" });
    await execFileAsync("tar", ["-xzf", archivePath, "-C", stagingDir], { timeout: 20 * 60 * 1000, maxBuffer: 1024 * 1024 * 64 });

    const extracted = await fs.readdir(stagingDir);

    let restoredDatabase = false;
    const dbDumpPath = path.join(stagingDir, "database.dump");
    if (extracted.includes("database.dump")) {
      logEvent({ component: "deployment-restore", message: "Restoring database (pg_restore --clean --if-exists)...", status: "info" });
      await execFileAsync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--dbname", databaseUrl, dbDumpPath], { timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024 * 64 });
      restoredDatabase = true;
    }

    let redisRdbStagedAt: string | null = null;
    if (extracted.includes("redis.rdb")) {
      const stagedRedisPath = path.join(TEMP_DIR, "restore-redis.rdb");
      await fs.copyFile(path.join(stagingDir, "redis.rdb"), stagedRedisPath);
      redisRdbStagedAt = stagedRedisPath;
      logEvent({ component: "deployment-restore", message: `Redis RDB staged at ${stagedRedisPath} — restore.sh completes the Redis restore (requires Docker-host volume access this container doesn't have).`, status: "info" });
    }

    const restoredDirectories: string[] = [];
    for (const dir of BACKUP_INCLUDED_DIRECTORIES) {
      const extractedDirPath = path.join(stagingDir, dir);
      if (!fsSync.existsSync(extractedDirPath)) continue;
      const targetPath = path.join(APP_ROOT, dir);
      logEvent({ component: "deployment-restore", message: `Restoring ${dir}/...`, status: "info" });
      // Replace, don't merge — a restore should leave the directory
      // exactly as it was at backup time, not layered on top of
      // whatever's there now (which could reintroduce stale/orphaned
      // files a real restore is meant to eliminate).
      await fs.rm(targetPath, { recursive: true, force: true });
      await fs.rename(extractedDirPath, targetPath);
      restoredDirectories.push(dir);
    }

    logEvent({ component: "deployment-restore", message: `Restore complete: ${fileName} (db=${restoredDatabase}, redis=${redisRdbStagedAt !== null}, dirs=${restoredDirectories.join(",")})`, status: "success" });
    recordAuditEvent({ type: "deployment_restore_performed", detail: `${fileName} (db=${restoredDatabase}, dirs=${restoredDirectories.join(",")})`, component: "deployment-restore" });
    return { fileName, restoredDatabase, redisRdbStagedAt, restoredDirectories };
  } catch (err) {
    logEvent({ component: "deployment-restore", message: `Restore of ${fileName} failed partway through — system state may now be inconsistent (some directories/database may already be overwritten). Restore from a different backup or investigate manually before resuming normal operation.`, status: "error", error: formatError(err) });
    throw err;
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
