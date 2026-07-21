import fs from "node:fs/promises";
import path from "node:path";
import { LOGS_DIR } from "../config/paths";
import type { InstallLogEntry } from "@kvl/shared";

const LOG_FILE = path.join(LOGS_DIR, "installer.log");

/** Tails the structured JSON-lines installer log — the file logger.ts writes to for every event. */
export async function readRecentLogs(limit = 100): Promise<InstallLogEntry[]> {
  let content: string;
  try {
    content = await fs.readFile(LOG_FILE, "utf-8");
  } catch {
    return [];
  }

  const lines = content.trim().split("\n").filter(Boolean);
  const recent = lines.slice(-limit);
  const entries: InstallLogEntry[] = [];
  for (const line of recent) {
    try {
      entries.push(JSON.parse(line) as InstallLogEntry);
    } catch {
      // skip malformed lines rather than failing the whole read
    }
  }
  return entries;
}
