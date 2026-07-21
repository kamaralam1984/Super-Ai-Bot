import path from "node:path";

/**
 * Single source of truth for the installation root. Anchored to __dirname
 * (not process.cwd()) so path resolution is identical whether the process is
 * started via `tsx src/index.ts`, `node dist/index.js`, or from a systemd
 * unit with an arbitrary working directory — all of which real installers
 * must tolerate.
 *
 * Layout: <APP_ROOT>/{backend,frontend,shared,logs,storage,cache,uploads,
 * models,embeddings,knowledge,config,backups,plugins,connectors,temp,.env}
 */
export const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
export const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

export const ENV_FILE_PATH = path.join(APP_ROOT, ".env");
export const LOGS_DIR = path.join(APP_ROOT, "logs");
export const MODELS_DIR = path.join(APP_ROOT, "models");
export const BACKUPS_DIR = path.join(APP_ROOT, "backups");
export const PLUGINS_DIR = path.join(APP_ROOT, "plugins");
export const TEMP_DIR = path.join(APP_ROOT, "temp");

export const RUNTIME_DIRECTORIES = [
  "logs",
  "storage",
  "cache",
  "uploads",
  "models",
  "embeddings",
  "knowledge",
  "config",
  "backups",
  "plugins",
  "connectors",
  "temp",
] as const;
