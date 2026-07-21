import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { probeCommand } from "./shell";

const execFileAsync = promisify(execFile);

export interface DockerStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
}

/** Single source of truth for Docker detection — used by both the System Check and Environment Validation steps. */
export async function getDockerStatus(): Promise<DockerStatus> {
  const probe = await probeCommand("docker", ["--version"]);
  if (!probe.found) {
    return { installed: false, running: false, version: null };
  }
  try {
    await execFileAsync("docker", ["info"], { timeout: 5000 });
    return { installed: true, running: true, version: probe.raw };
  } catch {
    return { installed: true, running: false, version: probe.raw };
  }
}
