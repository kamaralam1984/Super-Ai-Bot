// Machine fingerprint — what a license activation binds to. Reads
// /etc/machine-id (the standard, stable-across-reboots unique ID every
// systemd-based Linux install already has — this product's only
// supported OS family, see docs/DEPLOYMENT.md's supported environments)
// combined with the hostname, hashed. Falls back to a persisted random
// ID (written once, under `config/`) for environments without
// /etc/machine-id — a minimal container base image, for instance — so
// fingerprinting still works, just without systemd's cross-reboot
// guarantee (a persisted file survives container restarts via the same
// `config/` volume every other piece of persistent config already uses).

import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { APP_ROOT } from "../../config/paths";

const MACHINE_ID_PATHS = ["/etc/machine-id", "/var/lib/dbus/machine-id"];
const FALLBACK_ID_PATH = path.join(APP_ROOT, "config", "machine-id-fallback");

function readSystemMachineId(): string | null {
  for (const candidate of MACHINE_ID_PATHS) {
    try {
      const content = fs.readFileSync(candidate, "utf-8").trim();
      if (content) return content;
    } catch {
      continue;
    }
  }
  return null;
}

function readOrCreateFallbackId(): string {
  try {
    return fs.readFileSync(FALLBACK_ID_PATH, "utf-8").trim();
  } catch {
    const generated = crypto.randomUUID();
    fs.mkdirSync(path.dirname(FALLBACK_ID_PATH), { recursive: true, mode: 0o750 });
    fs.writeFileSync(FALLBACK_ID_PATH, generated, { mode: 0o600 });
    return generated;
  }
}

/** SHA-256 hex digest — a stable, opaque per-machine identifier, never the raw machine-id (which some environments consider mildly sensitive) persisted directly into a license file that may be shared with a vendor. */
export function computeMachineFingerprint(): string {
  const machineId = readSystemMachineId() ?? readOrCreateFallbackId();
  return crypto.createHash("sha256").update(`${machineId}:${os.hostname()}`).digest("hex");
}
