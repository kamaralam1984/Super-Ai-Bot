import fs from "node:fs/promises";
import path from "node:path";
import type { DirectoryEntry, DirectoryStructureResult } from "@kvl/shared";
import { APP_ROOT, RUNTIME_DIRECTORIES } from "../config/paths";
import { logEvent } from "../utils/logger";

// Owner rwx, group rx, no access for others — data directories hold generated
// secrets/config/backups, so world-readable is never appropriate here.
const DIR_MODE = 0o750;

async function ensureDirectory(name: string): Promise<DirectoryEntry> {
  const dirPath = path.join(APP_ROOT, name);
  let existedBefore = true;
  try {
    await fs.access(dirPath);
  } catch {
    existedBefore = false;
  }

  await fs.mkdir(dirPath, { recursive: true, mode: DIR_MODE });
  // mkdir's `mode` is filtered by the process umask, so enforce it explicitly.
  await fs.chmod(dirPath, DIR_MODE);
  const stat = await fs.stat(dirPath);

  return {
    name,
    path: dirPath,
    created: !existedBefore,
    mode: (stat.mode & 0o777).toString(8),
  };
}

/** Step 7 — Directory Structure. Creates every runtime data directory with locked-down permissions. Idempotent. */
export async function createDirectoryStructure(): Promise<DirectoryStructureResult> {
  const entries: DirectoryEntry[] = [];
  for (const name of RUNTIME_DIRECTORIES) {
    entries.push(await ensureDirectory(name));
  }

  const createdCount = entries.filter((e) => e.created).length;
  logEvent({
    component: "directory-manager",
    message: `Ensured ${entries.length} runtime directories under ${APP_ROOT} (${createdCount} newly created)`,
    status: "success",
  });

  return { entries, allReady: true };
}
