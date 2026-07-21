// CLI entrypoint for on-demand backups — invoked by deploy/scripts/backup.sh
// (a thin `docker compose exec backend node dist/deployment/cli/runBackup.js`
// wrapper) and by update.sh's pre-update safety-net backup. The REST
// endpoint (deployment.routes.ts) covers the same operation for the admin
// dashboard; this covers the host-shell / scripted case.

import { runBackup } from "../backup/backupService";
import { getActiveInstallationId } from "../../scanner/scanRecord.service";

async function main(): Promise<void> {
  const label = process.argv[2] || null;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set.");

  const installationId = await getActiveInstallationId(databaseUrl);
  if (!installationId) throw new Error("No completed installation found — nothing to back up yet.");

  const result = await runBackup(databaseUrl, installationId, "MANUAL", label);
  console.log(`Backup complete: ${result.filePath} (${(result.sizeBytes / 1024 / 1024).toFixed(1)}MB, sha256=${result.checksumSha256})`);
}

main().catch((err) => {
  console.error("runBackup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
