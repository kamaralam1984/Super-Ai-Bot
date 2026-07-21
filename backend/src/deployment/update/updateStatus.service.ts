// Update Manager — the backend's role is reporting, not performing.
// Actually pulling code / rebuilding images / restarting containers
// requires operating on the Docker host itself, which a process running
// *inside* one of those containers cannot safely do without mounting the
// Docker socket into it — a real privilege-escalation risk (a compromised
// backend container could then control every other container, including
// re-writing its own image) this product's zero-trust posture rejects,
// consistent with the same reasoning nginx's cert-reload loop uses
// instead of Docker-socket access (see docker-compose.yml's nginx
// service comment). The actual update flow (git pull, backup, rebuild,
// migrate, restart, health-check, rollback) is deploy/scripts/update.sh,
// run on the host outside any container. This module answers "what
// version is currently running" for the admin dashboard/API to display.

import fs from "node:fs";
import path from "node:path";

export interface VersionInfo {
  version: string;
  nodeVersion: string;
  nodeEnv: string;
  startedAt: string;
}

const STARTED_AT = new Date().toISOString();

function readBackendVersion(): string {
  try {
    // backend/package.json — two levels up from dist/deployment/update/
    // at runtime, or src/deployment/update/ in dev via tsx.
    const packageJsonPath = path.resolve(__dirname, "..", "..", "..", "package.json");
    const raw = fs.readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const BACKEND_VERSION = readBackendVersion();

export function getVersionInfo(): VersionInfo {
  return {
    version: BACKEND_VERSION,
    nodeVersion: process.version,
    nodeEnv: process.env.NODE_ENV ?? "development",
    startedAt: STARTED_AT,
  };
}
