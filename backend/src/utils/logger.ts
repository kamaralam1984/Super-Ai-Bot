import path from "node:path";
import fs from "node:fs";
import winston from "winston";
import type { InstallLogEntry } from "@kvl/shared";
import { LOGS_DIR } from "../config/paths";

/**
 * Central structured logger. Every installation event is written both to the
 * console (human-readable, colorized) and to logs/installer.log as JSON lines
 * matching the InstallLogEntry contract (time, status, component, duration, error) —
 * this satisfies the spec's "Log every installation event" requirement and gives
 * Step 10 (Error Recovery) and Step 11 (Logging) a single source of truth to read from.
 */

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true, mode: 0o750 });
}

interface LogMeta {
  timestamp?: string;
  level?: string;
  message?: unknown;
  status?: InstallLogEntry["status"];
  component?: string;
  durationMs?: number;
  error?: string;
}

const jsonLineFormat = winston.format.printf((info) => {
  const meta = info as LogMeta;
  const entry: InstallLogEntry = {
    time: meta.timestamp ?? new Date().toISOString(),
    status: meta.status ?? (meta.level === "error" ? "error" : "info"),
    component: meta.component ?? "system",
    message: String(meta.message ?? ""),
    ...(meta.durationMs !== undefined ? { durationMs: meta.durationMs } : {}),
    ...(meta.error !== undefined ? { error: meta.error } : {}),
  };
  return JSON.stringify(entry);
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: winston.format.combine(winston.format.timestamp(), jsonLineFormat),
  transports: [
    new winston.transports.File({
      filename: path.join(LOGS_DIR, "installer.log"),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message, component }) => {
          const tag = component ? `[${component}]` : "";
          return `${timestamp} ${level} ${tag} ${message}`;
        })
      ),
    }),
  ],
});

export interface LogEventInput {
  component: string;
  message: string;
  status?: InstallLogEntry["status"];
  durationMs?: number;
  error?: string;
}

/** Convenience wrapper matching the InstallLogEntry contract exactly. */
export function logEvent(input: LogEventInput): void {
  const level = input.status === "error" ? "error" : input.status === "warn" ? "warn" : "info";
  logger.log(level, input.message, {
    component: input.component,
    status: input.status ?? "info",
    durationMs: input.durationMs,
    error: input.error,
  });
}

/** Times an async step and logs start/success/failure automatically. */
export async function withTimedLog<T>(component: string, message: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  logEvent({ component, message: `${message} — started`, status: "info" });
  try {
    const result = await fn();
    logEvent({ component, message: `${message} — completed`, status: "success", durationMs: Math.round(performance.now() - start) });
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logEvent({ component, message: `${message} — failed`, status: "error", durationMs: Math.round(performance.now() - start), error: errorMessage });
    throw err;
  }
}
