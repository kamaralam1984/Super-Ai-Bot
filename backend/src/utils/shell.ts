import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandProbeResult {
  found: boolean;
  version: string | null;
  raw: string | null;
}

/**
 * Probes for a CLI tool's presence/version using execFile (argument array,
 * never a shell string) so this can never be subverted into shell injection —
 * every argument here is a fixed literal, but the discipline matters as this
 * module grows to cover more tools.
 */
export async function probeCommand(command: string, versionArgs: string[] = ["--version"]): Promise<CommandProbeResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, versionArgs, { timeout: 5000 });
    const raw = (stdout || stderr).trim();
    const versionMatch = raw.match(/(\d+\.\d+(\.\d+)?)/);
    return { found: true, version: versionMatch ? versionMatch[1] : raw.split("\n")[0], raw };
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      return { found: false, version: null, raw: null };
    }
    // Command exists but exited non-zero (e.g. docker daemon not running) — still "found".
    return { found: true, version: null, raw: nodeErr.message };
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
