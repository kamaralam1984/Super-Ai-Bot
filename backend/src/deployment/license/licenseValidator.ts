// License Management — signature verification and payload parsing. Pure
// cryptographic/data logic (node:crypto's signature verification is a
// synchronous, deterministic function over its inputs — no I/O, no
// Prisma) separated from licenseService.ts's orchestration (DB
// persistence, machine fingerprint file reads).
//
// This is LOCAL, offline license validation — there is no SaaS license
// server anywhere in this product (consistent with its "NOT a SaaS
// platform" positioning), and there never needs to be one: a license
// file is an Ed25519-signed JSON payload; verifying it is a single
// public-key signature check against bytes already in hand. "Offline
// Activation" in the original spec's sense is therefore the *only* mode
// this system has — there's no separate online-vs-offline branch to
// build, because nothing here ever calls home.

import crypto from "node:crypto";

export type LicenseTier = "STANDARD" | "ENTERPRISE" | "AGENCY";

export interface LicensePayload {
  licenseKey: string;
  tier: LicenseTier;
  issuedAt: string; // ISO 8601
  expiresAt: string | null; // ISO 8601, null = perpetual
  /** Bound to a machine on first activation (see licenseService.ts's activateLicense) — absent in a freshly-issued, not-yet-activated license file. */
  machineFingerprint: string | null;
  customerName: string;
  maxActivations: number;
}

export interface SignedLicenseFile {
  payload: LicensePayload;
  /** base64-encoded Ed25519 signature over JSON.stringify(payload) with sorted keys (see canonicalize below) — deterministic regardless of the JSON serializer's own key ordering. */
  signature: string;
}

/**
 * Out-of-the-box default keypair so this system is testable/demoable
 * without any setup — genuinely generated (not fabricated), but its
 * private half is NOT included anywhere in this codebase (shown once,
 * transiently, when it was generated) and MUST NOT be treated as secret
 * by anyone who reads this file, because it isn't: this exact public key
 * being visible in open source means anyone can find (or has already
 * seen) its matching private key. A real commercial deployment MUST
 * generate its own keypair (deployment/cli/generateLicenseKeypair.ts),
 * set LICENSE_PUBLIC_KEY to the new public key, and keep the private key
 * completely offline — only ever used by deployment/cli/signLicense.ts
 * on a machine that never runs this server.
 */
const DEFAULT_LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAVpDOUzqvHovPaMKc5E+tRoYKgzZiqOaacjDmGtgxRBA=
-----END PUBLIC KEY-----`;

export function getLicensePublicKeyPem(): string {
  return process.env.LICENSE_PUBLIC_KEY?.trim() || DEFAULT_LICENSE_PUBLIC_KEY_PEM;
}

/** Deterministic serialization — sorted keys, no whitespace — so the exact same payload object always signs/verifies to the same bytes regardless of property insertion order. */
export function canonicalizePayload(payload: LicensePayload): string {
  const sorted = Object.keys(payload)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (payload as unknown as Record<string, unknown>)[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

export function signPayload(payload: LicensePayload, privateKeyPem: string): string {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(canonicalizePayload(payload)), privateKey);
  return signature.toString("base64");
}

export function verifySignature(payload: LicensePayload, signatureBase64: string, publicKeyPem: string = getLicensePublicKeyPem()): boolean {
  try {
    const publicKey = crypto.createPublicKey(publicKeyPem);
    return crypto.verify(null, Buffer.from(canonicalizePayload(payload)), publicKey, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false; // malformed key/signature material — never a valid license
  }
}

export function parseLicenseFile(content: string): SignedLicenseFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`License file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null || !("payload" in parsed) || !("signature" in parsed)) {
    throw new Error('License file must be a JSON object with "payload" and "signature" fields');
  }
  const { payload, signature } = parsed as { payload: unknown; signature: unknown };
  if (typeof signature !== "string") {
    throw new Error('License file\'s "signature" must be a string');
  }
  if (typeof payload !== "object" || payload === null) {
    throw new Error('License file\'s "payload" must be an object');
  }
  const p = payload as Record<string, unknown>;
  const requiredStringFields = ["licenseKey", "tier", "issuedAt", "customerName"];
  for (const field of requiredStringFields) {
    if (typeof p[field] !== "string") throw new Error(`License payload missing required string field "${field}"`);
  }
  if (!["STANDARD", "ENTERPRISE", "AGENCY"].includes(p.tier as string)) {
    throw new Error(`License payload has an invalid tier: ${String(p.tier)}`);
  }
  if (typeof p.maxActivations !== "number" || p.maxActivations < 1) {
    throw new Error('License payload\'s "maxActivations" must be a positive number');
  }
  return {
    payload: {
      licenseKey: p.licenseKey as string,
      tier: p.tier as LicenseTier,
      issuedAt: p.issuedAt as string,
      expiresAt: (p.expiresAt as string | null) ?? null,
      machineFingerprint: (p.machineFingerprint as string | null) ?? null,
      customerName: p.customerName as string,
      maxActivations: p.maxActivations,
    },
    signature,
  };
}

export type LicenseVerdictReason = "valid" | "invalid_signature" | "expired" | "machine_mismatch" | "malformed";

export interface LicenseVerdict {
  ok: boolean;
  reason: LicenseVerdictReason;
  detail: string;
}

export interface EvaluateLicenseParams {
  /** This host's own fingerprint right now (machineFingerprint.ts's computeMachineFingerprint()). */
  currentMachineFingerprint: string;
  /**
   * The fingerprint this license is actually bound to, if any — NOT
   * necessarily `file.payload.machineFingerprint` (that's only what the
   * vendor pre-declared when *issuing* the file, for the classic
   * request-fingerprint-then-issue offline activation flow). For
   * re-validating an *already activated* license, the caller passes the
   * fingerprint recorded in the database at activation time instead —
   * see licenseService.ts's activateLicense vs. validateLicense for the
   * two different call sites this distinction matters for.
   */
  boundFingerprint: string | null;
}

/**
 * The full offline check: signature integrity, then expiry, then machine
 * binding — in that order, since a forged/tampered payload's expiry or
 * fingerprint fields can't be trusted at all until the signature itself
 * is confirmed genuine.
 */
export function evaluateLicense(file: SignedLicenseFile, params: EvaluateLicenseParams, now: Date = new Date(), publicKeyPem: string = getLicensePublicKeyPem()): LicenseVerdict {
  if (!verifySignature(file.payload, file.signature, publicKeyPem)) {
    return { ok: false, reason: "invalid_signature", detail: "Signature does not match the license payload — the file is forged, corrupted, or was signed by an unrecognized key." };
  }
  if (file.payload.expiresAt && new Date(file.payload.expiresAt).getTime() < now.getTime()) {
    return { ok: false, reason: "expired", detail: `License expired on ${file.payload.expiresAt}.` };
  }
  if (params.boundFingerprint && params.boundFingerprint !== params.currentMachineFingerprint) {
    return { ok: false, reason: "machine_mismatch", detail: "This license is bound to a different machine." };
  }
  return { ok: true, reason: "valid", detail: `Valid ${file.payload.tier} license for ${file.payload.customerName}.` };
}
