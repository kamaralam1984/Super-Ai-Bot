import dotenv from "dotenv";
import { z } from "zod";
import { ENV_FILE_PATH } from "./paths";

dotenv.config({ path: ENV_FILE_PATH });

/**
 * Boot-time config only. Installation-generated secrets (JWT_SECRET, ENCRYPTION_KEY, etc.)
 * are intentionally NOT validated here — they don't exist until Step 4/5 of the wizard
 * run, and this server must be able to boot *before* installation to serve the wizard
 * itself. ConfigManager (Step 4) re-reads process.env after writing the generated .env.
 */
const bootEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  INSTALLER_PORT: z.coerce.number().int().positive().default(4500),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  // Superuser/admin connection used ONLY during Step 6 to CREATE ROLE / CREATE DATABASE.
  // On a real VPS install running as root, DatabaseManager instead shells out to
  // `sudo -u postgres psql` and never needs this — it's the fallback for
  // non-root environments (like local development) where an admin DSN must be
  // supplied explicitly. Never written into the generated app .env for the
  // installed product itself.
  DATABASE_ADMIN_URL: z.string().optional(),
});

const parsed = bootEnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid boot environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const bootConfig = parsed.data;

/** True once the Installer has written a real .env with generated secrets. */
export function isInstalled(): boolean {
  return Boolean(process.env.INSTALLATION_ID && process.env.JWT_SECRET);
}
