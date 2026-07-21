import crypto from "node:crypto";

/**
 * Step 5 — Security. Generates cryptographically random secrets using Node's
 * crypto.randomBytes (CSPRNG, not Math.random). Raw values are written to
 * .env only (see configFile.util.ts) and are never returned by any API
 * response — only one-way fingerprints (see `fingerprint`) are safe to persist
 * elsewhere (e.g. the database audit trail in Step 6).
 */
export interface GeneratedSecrets {
  jwtSecret: string;
  encryptionKey: string;
  apiSecret: string;
  webhookSecret: string;
  csrfSecret: string;
  cookieSecret: string;
  sessionSecret: string;
}

function randomSecret(bytes: number, encoding: "base64url" | "hex" = "base64url"): string {
  return crypto.randomBytes(bytes).toString(encoding);
}

export function generateSecrets(): GeneratedSecrets {
  return {
    jwtSecret: randomSecret(64),
    encryptionKey: randomSecret(32, "hex"), // 256-bit key, hex-encoded for direct use as an AES-256 key
    apiSecret: randomSecret(32),
    webhookSecret: randomSecret(32),
    csrfSecret: randomSecret(32),
    cookieSecret: randomSecret(32),
    sessionSecret: randomSecret(32),
  };
}

export function generateDatabasePassword(): string {
  return randomSecret(24);
}

/** One-way SHA-256 fingerprint. Safe to store/log/display — the raw secret can never be recovered from it. */
export function fingerprint(secretValue: string): string {
  return crypto.createHash("sha256").update(secretValue).digest("hex");
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}
