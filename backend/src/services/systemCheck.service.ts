import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RequirementCheckItem, RequirementCheckResult } from "@kvl/shared";
import { probeCommand } from "../utils/shell";
import { getDiskSpace } from "../utils/diskSpace";
import { isPortOpen, checkInternetConnectivity } from "../utils/network";
import { getDockerStatus } from "../utils/docker";
import { APP_ROOT } from "../config/paths";
import { logEvent } from "../utils/logger";

const execFileAsync = promisify(execFile);

const MIN_CPU_CORES = 2;
const MIN_RAM_GB = 4;
const WARN_RAM_GB = 2;
const MIN_DISK_GB = 10;
const WARN_DISK_GB = 5;
const MIN_NODE_MAJOR = 18;

const bytesToGb = (bytes: number) => bytes / 1024 ** 3;
const kbToGb = (kb: number) => kb / 1024 ** 2;

async function checkCpu(): Promise<RequirementCheckItem> {
  const cpus = os.cpus();
  const cores = cpus.length;
  const model = cpus[0]?.model?.trim() ?? "Unknown CPU";
  return {
    id: "cpu",
    label: "CPU",
    status: cores >= MIN_CPU_CORES ? "pass" : "warn",
    detail: `${cores} core(s) detected — ${model} (minimum recommended: ${MIN_CPU_CORES})`,
    required: true,
  };
}

async function checkRam(): Promise<RequirementCheckItem> {
  const totalGb = bytesToGb(os.totalmem());
  const status = totalGb >= MIN_RAM_GB ? "pass" : totalGb >= WARN_RAM_GB ? "warn" : "fail";
  return {
    id: "ram",
    label: "RAM",
    status,
    detail: `${totalGb.toFixed(1)} GB total (recommended: ${MIN_RAM_GB} GB, minimum: ${WARN_RAM_GB} GB)`,
    required: true,
  };
}

async function checkDisk(): Promise<RequirementCheckItem> {
  try {
    const disk = await getDiskSpace(APP_ROOT);
    const freeGb = kbToGb(disk.availableKb);
    const status = freeGb >= MIN_DISK_GB ? "pass" : freeGb >= WARN_DISK_GB ? "warn" : "fail";
    return {
      id: "disk",
      label: "Disk Space",
      status,
      detail: `${freeGb.toFixed(1)} GB free (recommended: ${MIN_DISK_GB} GB, minimum: ${WARN_DISK_GB} GB)`,
      required: true,
    };
  } catch (err) {
    return { id: "disk", label: "Disk Space", status: "fail", detail: `Could not read disk space: ${(err as Error).message}`, required: true };
  }
}

async function checkNode(): Promise<RequirementCheckItem> {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    id: "nodejs",
    label: "Node.js",
    status: major >= MIN_NODE_MAJOR ? "pass" : "fail",
    detail: `v${process.versions.node} detected (minimum required: v${MIN_NODE_MAJOR})`,
    required: true,
  };
}

async function checkPython(): Promise<RequirementCheckItem> {
  const probe = await probeCommand("python3", ["--version"]);
  return {
    id: "python",
    label: "Python",
    status: probe.found ? "pass" : "warn",
    detail: probe.found ? `${probe.raw} detected` : "Not found — only required for optional ML connectors/plugins",
    required: false,
  };
}

async function checkGit(): Promise<RequirementCheckItem> {
  const probe = await probeCommand("git", ["--version"]);
  return {
    id: "git",
    label: "Git",
    status: probe.found ? "pass" : "fail",
    detail: probe.found ? `${probe.raw} detected` : "Not found — required to fetch and update the application",
    required: true,
  };
}

async function checkDocker(): Promise<{ item: RequirementCheckItem; installed: boolean; running: boolean }> {
  const status = await getDockerStatus();
  if (!status.installed) {
    return {
      item: { id: "docker", label: "Docker", status: "warn", detail: "Not found — optional if installing natively on Ubuntu/Debian", required: false },
      installed: false,
      running: false,
    };
  }
  return {
    item: {
      id: "docker",
      label: "Docker",
      status: status.running ? "pass" : "warn",
      detail: status.running ? `${status.version} — daemon running` : `${status.version} — installed but daemon not running or not accessible`,
      required: false,
    },
    installed: true,
    running: status.running,
  };
}

async function checkDockerCompose(dockerInstalled: boolean): Promise<RequirementCheckItem> {
  if (dockerInstalled) {
    try {
      const { stdout } = await execFileAsync("docker", ["compose", "version"], { timeout: 5000 });
      return { id: "docker_compose", label: "Docker Compose", status: "pass", detail: stdout.trim(), required: false };
    } catch {
      // fall through to legacy standalone binary check
    }
  }
  const probe = await probeCommand("docker-compose", ["--version"]);
  return {
    id: "docker_compose",
    label: "Docker Compose",
    status: probe.found ? "pass" : "warn",
    detail: probe.found ? `${probe.raw} detected` : "Not found — optional if installing natively on Ubuntu/Debian",
    required: false,
  };
}

async function checkRedis(dockerAvailable: boolean): Promise<RequirementCheckItem> {
  const [probe, portOpen] = await Promise.all([probeCommand("redis-cli", ["--version"]), isPortOpen("127.0.0.1", 6379)]);
  const required = !dockerAvailable;
  if (portOpen) {
    return { id: "redis", label: "Redis", status: "pass", detail: "Reachable on 127.0.0.1:6379", required };
  }
  if (probe.found) {
    return { id: "redis", label: "Redis", status: "warn", detail: `${probe.raw} installed but not reachable on port 6379 — is the service running?`, required };
  }
  return {
    id: "redis",
    label: "Redis",
    status: required ? "fail" : "warn",
    detail: dockerAvailable ? "Not found natively — will be provisioned via Docker" : "Not found and not reachable — install Redis or Docker",
    required,
  };
}

async function checkPostgres(dockerAvailable: boolean): Promise<RequirementCheckItem> {
  const [probe, portOpen] = await Promise.all([probeCommand("psql", ["--version"]), isPortOpen("127.0.0.1", 5432)]);
  const required = !dockerAvailable;
  if (portOpen) {
    return { id: "postgresql", label: "PostgreSQL", status: "pass", detail: "Reachable on 127.0.0.1:5432", required };
  }
  if (probe.found) {
    return { id: "postgresql", label: "PostgreSQL", status: "warn", detail: `${probe.raw} installed but not reachable on port 5432 — is the service running?`, required };
  }
  return {
    id: "postgresql",
    label: "PostgreSQL",
    status: required ? "fail" : "warn",
    detail: dockerAvailable ? "Not found natively — will be provisioned via Docker" : "Not found and not reachable — install PostgreSQL or Docker",
    required,
  };
}

async function checkInternet(): Promise<RequirementCheckItem> {
  const result = await checkInternetConnectivity();
  return {
    id: "internet",
    label: "Internet Connection",
    status: result.online ? "pass" : "fail",
    detail: result.detail,
    required: true,
  };
}

/**
 * Step 1 — System Requirement Check. Runs every probe concurrently against the
 * real host (no mocked data) and returns green/red/yellow status per item.
 * PostgreSQL/Redis become "required" only when Docker is unavailable, since
 * Docker can provision both as containers later in the install.
 */
export async function runSystemCheck(): Promise<RequirementCheckResult> {
  const [cpu, ram, disk, nodejs, python, git, dockerResult] = await Promise.all([
    checkCpu(),
    checkRam(),
    checkDisk(),
    checkNode(),
    checkPython(),
    checkGit(),
    checkDocker(),
  ]);

  const dockerAvailable = dockerResult.installed && dockerResult.running;

  const [dockerCompose, redis, postgresql, internet] = await Promise.all([
    checkDockerCompose(dockerResult.installed),
    checkRedis(dockerAvailable),
    checkPostgres(dockerAvailable),
    checkInternet(),
  ]);

  const items: RequirementCheckItem[] = [cpu, ram, disk, nodejs, python, dockerResult.item, dockerCompose, git, redis, postgresql, internet];
  const allRequiredPassed = items.filter((i) => i.required).every((i) => i.status === "pass" || i.status === "warn");

  logEvent({
    component: "system-check",
    message: `System requirement check completed — ${items.filter((i) => i.status === "fail").length} failing, ${items.filter((i) => i.status === "warn").length} warnings`,
    status: allRequiredPassed ? "success" : "warn",
  });

  return { items, allRequiredPassed, checkedAt: new Date().toISOString() };
}
