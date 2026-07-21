import { Client } from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { bootConfig } from "../config/env";
import { assertSafeIdentifier, quoteIdentifier, quoteLiteral } from "../utils/pgIdentifier";
import { logEvent, withTimedLog } from "../utils/logger";
import { APP_ROOT, BACKEND_ROOT } from "../config/paths";
import { AppError } from "../middleware/errorHandler";

const execFileAsync = promisify(execFile);
// npm workspaces hoists binaries to the repo root's node_modules/.bin, not backend's.
const PRISMA_BIN = path.join(APP_ROOT, "node_modules", ".bin", "prisma");
const SCHEMA_PATH = path.join(BACKEND_ROOT, "prisma", "schema.prisma");

export interface DatabaseBootstrapInput {
  databaseName: string;
  databaseUser: string;
  databasePassword: string;
}

/**
 * Connects to the Postgres maintenance database via an admin/superuser DSN.
 * On a real VPS where the installer runs as root, the production build of
 * this function should instead shell out to `sudo -u postgres psql` so no
 * superuser password ever needs to be stored — DATABASE_ADMIN_URL is the
 * documented fallback for non-root environments (see .env.example).
 */
async function getAdminClient(): Promise<Client> {
  if (!bootConfig.DATABASE_ADMIN_URL) {
    throw new AppError(
      500,
      "No PostgreSQL admin connection is configured",
      "Set DATABASE_ADMIN_URL in .env, or run the installer as root so it can use `sudo -u postgres psql` automatically.",
      true
    );
  }
  const client = new Client({ connectionString: bootConfig.DATABASE_ADMIN_URL });
  await client.connect();
  return client;
}

async function roleExists(admin: Client, roleName: string): Promise<boolean> {
  const result = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [roleName]);
  return (result.rowCount ?? 0) > 0;
}

async function databaseExists(admin: Client, dbName: string): Promise<boolean> {
  const result = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  return (result.rowCount ?? 0) > 0;
}

async function ensureRoleAndDatabase(input: DatabaseBootstrapInput): Promise<void> {
  assertSafeIdentifier(input.databaseName, "database name");
  assertSafeIdentifier(input.databaseUser, "database user");

  const admin = await getAdminClient();
  try {
    await withTimedLog("database-manager", `Ensure role ${input.databaseUser}`, async () => {
      const exists = await roleExists(admin, input.databaseUser);
      const passwordLiteral = quoteLiteral(input.databasePassword);
      const roleIdentifier = quoteIdentifier(input.databaseUser);
      if (exists) {
        await admin.query(`ALTER ROLE ${roleIdentifier} WITH LOGIN PASSWORD ${passwordLiteral}`);
      } else {
        await admin.query(`CREATE ROLE ${roleIdentifier} WITH LOGIN PASSWORD ${passwordLiteral}`);
      }
    });

    await withTimedLog("database-manager", `Ensure database ${input.databaseName}`, async () => {
      if (!(await databaseExists(admin, input.databaseName))) {
        await admin.query(`CREATE DATABASE ${quoteIdentifier(input.databaseName)} OWNER ${quoteIdentifier(input.databaseUser)}`);
      }
    });
  } finally {
    await admin.end();
  }
}

interface MigrationRunResult {
  stdout: string;
  appliedNow: boolean;
}

/** Applies Prisma's committed migration files (Required Tables, Indexes, Constraints) to the target database. */
async function runMigrations(): Promise<MigrationRunResult> {
  return withTimedLog("database-manager", "Apply Prisma migrations", async () => {
    const { stdout } = await execFileAsync(PRISMA_BIN, ["migrate", "deploy", "--schema", SCHEMA_PATH], {
      cwd: BACKEND_ROOT,
      timeout: 60000,
    });
    return { stdout, appliedNow: !stdout.includes("No pending migrations") };
  });
}

export interface MigrationStatusResult {
  raw: string;
}

/** Migration Status — reports which migrations are applied vs. pending, per the spec. */
export async function getMigrationStatus(): Promise<MigrationStatusResult> {
  try {
    const { stdout } = await execFileAsync(PRISMA_BIN, ["migrate", "status", "--schema", SCHEMA_PATH], { cwd: BACKEND_ROOT, timeout: 30000 });
    return { raw: stdout };
  } catch (err) {
    // `prisma migrate status` exits non-zero when migrations are pending — stdout still has the report.
    const execErr = err as { stdout?: string; message: string };
    return { raw: execErr.stdout ?? execErr.message };
  }
}

export interface DatabaseInitResult {
  databaseCreated: boolean;
  migrationsApplied: boolean;
  migrationOutput: string;
}

/** Full Step 6 orchestration: idempotently bootstrap role+database, then apply migrations. */
export async function initializeDatabase(input: DatabaseBootstrapInput): Promise<DatabaseInitResult> {
  await ensureRoleAndDatabase(input);
  const migration = await runMigrations();
  logEvent({ component: "database-manager", message: `Database ${input.databaseName} initialized and migrated`, status: "success" });
  return { databaseCreated: true, migrationsApplied: migration.appliedNow, migrationOutput: migration.stdout };
}

/** Rollback Support (Step 10) — drops the database and role created for a failed installation. */
export async function rollbackDatabase(input: DatabaseBootstrapInput): Promise<void> {
  assertSafeIdentifier(input.databaseName, "database name");
  assertSafeIdentifier(input.databaseUser, "database user");
  const admin = await getAdminClient();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(input.databaseName)}`);
    await admin.query(`DROP ROLE IF EXISTS ${quoteIdentifier(input.databaseUser)}`);
    logEvent({ component: "database-manager", message: `Rolled back database ${input.databaseName} and role ${input.databaseUser}`, status: "warn" });
  } finally {
    await admin.end();
  }
}
