// Docker-install completion CLI — the Docker deployment path's equivalent
// of what the browser Installer Wizard's Step 4 (Configuration) + Step 8
// (Finalizing) do together, for the one thing deploy/scripts/install.sh
// genuinely cannot do itself from bash: writing the Installation audit
// row via Prisma. Everything else the wizard's early steps cover (system
// check, environment validation, secret generation, directory creation,
// database init) is already handled by install.sh in a way appropriate
// to a container environment (see install.sh's own comments on why)
// before this ever runs — this script does NOT re-run or duplicate any
// of that.
//
// Invoked once, at the end of install.sh, as:
//   node dist/deployment/cli/dockerInstallFinalize.js --website-name "..." --website-url "..."
// Run inside the already-started backend container, where DATABASE_URL/
// APPLICATION_ID/INSTALLATION_ID are already present via env_file.

import { recordInstallationStart, finalizeInstallationRecord } from "../../services/installationRecord.service";
import { writeEnvFile } from "../../utils/envFileWriter";

function parseArgs(argv: string[]): { websiteName: string; websiteUrl: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key && value) args[key] = value;
  }
  if (!args["website-name"] || !args["website-url"]) {
    throw new Error("Usage: dockerInstallFinalize --website-name <name> --website-url <url>");
  }
  return { websiteName: args["website-name"], websiteUrl: args["website-url"] };
}

async function main(): Promise<void> {
  const { websiteName, websiteUrl } = parseArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  const applicationId = process.env.APPLICATION_ID;
  const installationId = process.env.INSTALLATION_ID;
  if (!databaseUrl || !applicationId || !installationId) {
    throw new Error("DATABASE_URL, APPLICATION_ID, and INSTALLATION_ID must already be set (install.sh's generated .env) before running this.");
  }

  const rowId = await recordInstallationStart(databaseUrl, { applicationId, installationId, websiteName, websiteUrl });
  await finalizeInstallationRecord(databaseUrl, rowId, "COMPLETED");
  await writeEnvFile({ WEBSITE_NAME: websiteName, WEBSITE_URL: websiteUrl });

  console.log(`Docker install finalized: installation=${installationId} website=${websiteUrl}`);
}

main().catch((err) => {
  console.error("dockerInstallFinalize failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
