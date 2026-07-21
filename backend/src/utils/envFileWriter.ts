import fs from "node:fs/promises";
import { ENV_FILE_PATH } from "../config/paths";

/**
 * Merges new key/value pairs into the installation's .env file and writes it
 * back with 0600 permissions (owner read/write only) — this is the "Save all
 * configuration securely" requirement from Step 4. Existing keys not passed
 * in `values` are preserved, so this can be called incrementally across
 * install steps without clobbering earlier writes.
 */
export async function writeEnvFile(values: Record<string, string>): Promise<void> {
  let existing: Record<string, string> = {};
  try {
    const content = await fs.readFile(ENV_FILE_PATH, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      existing[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  } catch {
    // No existing .env yet — this is the first write of the install.
  }

  const merged = { ...existing, ...values };
  // Double-quoted, with embedded backslashes/quotes escaped — dotenv (this
  // process's own loader, config/env.ts) and Docker Compose's env_file
  // both parse unquoted values with spaces fine, but this file is also a
  // legitimate target for `source .env`/systemd's EnvironmentFile= during
  // real deployment and manual debugging, and an unquoted value with a
  // space (a business name like "KVL Business Solutions" is a completely
  // ordinary one) breaks both of those outright. Quoting is a strict
  // improvement — every consumer this file has accepts it.
  const lines = Object.entries(merged).map(([key, value]) => `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  await fs.writeFile(ENV_FILE_PATH, lines.join("\n") + "\n", { mode: 0o600 });
  await fs.chmod(ENV_FILE_PATH, 0o600);

  // Apply immediately to the running process so later install steps (same
  // request lifecycle, no restart) see the fresh values via process.env.
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}
