import os from "node:os";
import type { EnvironmentInfo } from "@kvl/shared";
import { getOsInfo } from "../utils/osInfo";
import { detectLocalSsl } from "../utils/ssl";
import { detectFirewall } from "../utils/firewall";
import { probeCommand } from "../utils/shell";
import { isPortOpen, getPublicIp } from "../utils/network";
import { getDockerStatus } from "../utils/docker";
import { bootConfig } from "../config/env";
import { logEvent } from "../utils/logger";

const PORTS_TO_CHECK: { port: number; label: string }[] = [
  { port: 80, label: "HTTP" },
  { port: 443, label: "HTTPS" },
  { port: bootConfig.PORT, label: "Application API" },
  { port: bootConfig.INSTALLER_PORT, label: "Installer Wizard" },
  { port: 5432, label: "PostgreSQL" },
  { port: 6379, label: "Redis" },
];

/**
 * Step 2 — Environment Validation. Every field is a live read of the actual
 * host: OS release file, real TCP connects, a real outbound HTTPS call for
 * public IP, and (where permitted) real firewall/webserver CLI probes.
 */
export async function runEnvironmentValidation(): Promise<EnvironmentInfo> {
  const [osInfo, publicIp, port443Listening, firewall, nginxProbe, apacheProbe, docker, portResults] = await Promise.all([
    getOsInfo(),
    getPublicIp(),
    isPortOpen("127.0.0.1", 443),
    detectFirewall(),
    probeCommand("nginx", ["-v"]),
    probeCommand("apache2", ["-v"]),
    getDockerStatus(),
    Promise.all(PORTS_TO_CHECK.map(async ({ port, label }) => ({ port, label, inUse: await isPortOpen("127.0.0.1", port) }))),
  ]);

  const sslCertificate = await detectLocalSsl(port443Listening);

  const result: EnvironmentInfo = {
    os: osInfo.name,
    osVersion: osInfo.version,
    hostname: os.hostname(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    publicIp,
    https: { port443Listening },
    sslCertificate,
    ports: portResults,
    firewall,
    webServer: { nginx: nginxProbe.found, apache: apacheProbe.found },
    docker: { installed: docker.installed, running: docker.running, version: docker.version },
    detectedAt: new Date().toISOString(),
  };

  logEvent({ component: "environment-validation", message: `Environment detected: ${result.os} ${result.osVersion} on ${result.hostname}`, status: "success" });

  return result;
}
