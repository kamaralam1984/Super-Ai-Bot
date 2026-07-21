import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DiskSpaceInfo {
  totalKb: number;
  usedKb: number;
  availableKb: number;
}

/**
 * Reads free disk space for the given path via `df -kP` (POSIX-portable output format).
 * Linux/Debian/Ubuntu only, matching this product's supported OS list.
 */
export async function getDiskSpace(targetPath: string): Promise<DiskSpaceInfo> {
  const { stdout } = await execFileAsync("df", ["-kP", targetPath], { timeout: 5000 });
  const lines = stdout.trim().split("\n");
  const dataLine = lines[lines.length - 1];
  const columns = dataLine.trim().split(/\s+/);
  // Filesystem 1024-blocks Used Available Capacity Mounted-on
  const [, totalKb, usedKb, availableKb] = columns;
  return {
    totalKb: Number(totalKb),
    usedKb: Number(usedKb),
    availableKb: Number(availableKb),
  };
}
