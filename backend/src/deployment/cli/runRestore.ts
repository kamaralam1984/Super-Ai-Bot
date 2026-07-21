// CLI entrypoint for restoring a backup — invoked by deploy/scripts/
// restore.sh via `docker compose run --rm backend`, deliberately NOT the
// normal long-running backend service (see restoreService.ts's header
// comment on why the real service must be stopped first).
//
// Usage: runRestore.js <backupFileName> --confirm

import { BackupRecordService } from "../backup/backupRecord.service";
import { verifyBackupIntegrity, restoreFromArchive } from "../restore/restoreService";
import { getActiveInstallationId } from "../../scanner/scanRecord.service";

async function main(): Promise<void> {
  const fileName = process.argv[2];
  const confirmed = process.argv.includes("--confirm");
  if (!fileName) throw new Error("Usage: runRestore.js <backupFileName> --confirm");
  if (!confirmed) throw new Error("Refusing to restore without --confirm — this OVERWRITES the current database and every backed-up directory.");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set.");

  let expectedChecksum: string | null = null;
  try {
    const installationId = await getActiveInstallationId(databaseUrl);
    if (installationId) {
      const records = new BackupRecordService(databaseUrl);
      const all = await records.list(installationId, 500);
      await records.close();
      expectedChecksum = all.find((b) => b.filePath === fileName)?.checksumSha256 ?? null;
    }
  } catch {
    // The database may be exactly what's broken in a disaster-recovery
    // scenario — falling through to unverified restore (with a loud
    // warning, see verifyBackupIntegrity) is correct here, not a bug to
    // silently swallow-and-continue elsewhere.
  }

  await verifyBackupIntegrity(fileName, expectedChecksum);
  const result = await restoreFromArchive(databaseUrl, fileName);
  console.log(`Restore complete: db=${result.restoredDatabase} redisStaged=${result.redisRdbStagedAt ?? "none"} dirs=${result.restoredDirectories.join(",")}`);
}

main().catch((err) => {
  console.error("runRestore failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
