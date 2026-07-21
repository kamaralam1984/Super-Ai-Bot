import type { GeneratedConfig } from "@kvl/shared";
import { generateSecrets, generateDatabasePassword, generateId, fingerprint } from "./security.service";
import { writeEnvFile } from "../utils/envFileWriter";
import { logEvent } from "../utils/logger";

export interface InstallationConfigBundle {
  config: GeneratedConfig;
  /** One-way SHA-256 fingerprints of every generated secret — safe to persist to the audit trail (Step 6). */
  secretFingerprints: Record<string, string>;
}

/**
 * Step 4 — Configuration. Generates the Application ID, Installation ID,
 * database/vector-database/Redis configuration, and delegates secret
 * generation to the Security Manager (Step 5). Everything is written to
 * .env immediately; the return value deliberately excludes every secret —
 * callers (the HTTP route, the wizard UI) only ever see non-sensitive
 * identifiers and connection metadata. Only the internal orchestrator
 * (which needs fingerprints for the DB audit trail) uses the *Bundle variant.
 */
export async function generateInstallationConfigBundle(websiteName: string, websiteUrl: string): Promise<InstallationConfigBundle> {
  const applicationId = generateId("app");
  const installationId = generateId("inst");
  const secrets = generateSecrets();
  const dbPassword = generateDatabasePassword();
  const createdAt = new Date().toISOString();

  const database = {
    host: "localhost",
    port: 5432,
    name: `kvl_${applicationId.replace("app_", "")}`,
    user: `kvl_user_${applicationId.replace("app_", "").slice(0, 8)}`,
  };
  const vectorDatabase = {
    provider: "pgvector",
    host: database.host,
    port: database.port,
    collection: `kvl_vectors_${applicationId.replace("app_", "")}`,
  };
  const redis = { host: "localhost", port: 6379, db: 0 };

  await writeEnvFile({
    APPLICATION_ID: applicationId,
    INSTALLATION_ID: installationId,
    JWT_SECRET: secrets.jwtSecret,
    ENCRYPTION_KEY: secrets.encryptionKey,
    API_SECRET: secrets.apiSecret,
    WEBHOOK_SECRET: secrets.webhookSecret,
    CSRF_SECRET: secrets.csrfSecret,
    COOKIE_SECRET: secrets.cookieSecret,
    SESSION_SECRET: secrets.sessionSecret,
    DB_PASSWORD: dbPassword,
    DATABASE_URL: `postgresql://${database.user}:${dbPassword}@${database.host}:${database.port}/${database.name}`,
    REDIS_URL: `redis://${redis.host}:${redis.port}/${redis.db}`,
    VECTOR_DB_PROVIDER: vectorDatabase.provider,
    VECTOR_DB_COLLECTION: vectorDatabase.collection,
    WEBSITE_NAME: websiteName,
    WEBSITE_URL: websiteUrl,
    INSTALL_CREATED_AT: createdAt,
  });

  logEvent({
    component: "config-manager",
    message: `Generated configuration for installation ${installationId} (application ${applicationId})`,
    status: "success",
  });

  const secretFingerprints: Record<string, string> = {
    JWT_SECRET: fingerprint(secrets.jwtSecret),
    ENCRYPTION_KEY: fingerprint(secrets.encryptionKey),
    API_SECRET: fingerprint(secrets.apiSecret),
    WEBHOOK_SECRET: fingerprint(secrets.webhookSecret),
    CSRF_SECRET: fingerprint(secrets.csrfSecret),
    COOKIE_SECRET: fingerprint(secrets.cookieSecret),
    SESSION_SECRET: fingerprint(secrets.sessionSecret),
    DB_PASSWORD: fingerprint(dbPassword),
  };

  return { config: { applicationId, installationId, createdAt, database, vectorDatabase, redis }, secretFingerprints };
}

/** Public/HTTP-facing variant — same generation, but only ever returns the secret-free config. */
export async function generateInstallationConfig(websiteName: string, websiteUrl: string): Promise<GeneratedConfig> {
  const bundle = await generateInstallationConfigBundle(websiteName, websiteUrl);
  return bundle.config;
}
