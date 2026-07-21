import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { probeCommand } from "./shell";

const execFileAsync = promisify(execFile);

export interface FirewallInfo {
  active: boolean | null;
  tool: string | null;
  detail: string;
}

/**
 * Detects the active firewall tool. Ubuntu/Debian default to ufw; some environments
 * run firewalld instead. Querying live status often requires root — when this
 * process lacks permission, we report the tool found but leave `active` as null
 * rather than guessing, so the wizard UI can prompt the operator to confirm manually.
 */
export async function detectFirewall(): Promise<FirewallInfo> {
  const ufwProbe = await probeCommand("ufw", ["version"]);
  if (ufwProbe.found) {
    try {
      const { stdout } = await execFileAsync("ufw", ["status"], { timeout: 5000 });
      const active = /Status:\s*active/i.test(stdout);
      return { active, tool: "ufw", detail: stdout.trim().split("\n")[0] };
    } catch (err) {
      return { active: null, tool: "ufw", detail: `ufw installed but status query failed (likely needs root): ${(err as Error).message}` };
    }
  }

  const firewalldProbe = await probeCommand("firewall-cmd", ["--version"]);
  if (firewalldProbe.found) {
    try {
      const { stdout } = await execFileAsync("firewall-cmd", ["--state"], { timeout: 5000 });
      return { active: stdout.trim() === "running", tool: "firewalld", detail: stdout.trim() };
    } catch (err) {
      return { active: null, tool: "firewalld", detail: `firewalld installed but state query failed: ${(err as Error).message}` };
    }
  }

  return { active: null, tool: null, detail: "No known firewall tool (ufw/firewalld) detected" };
}
