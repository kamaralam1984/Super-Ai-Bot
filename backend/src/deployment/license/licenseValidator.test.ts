import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { signPayload, verifySignature, parseLicenseFile, evaluateLicense, canonicalizePayload, type LicensePayload, type SignedLicenseFile } from "./licenseValidator";

// A real, freshly-generated Ed25519 keypair for this test file only —
// never the built-in default (see licenseValidator.ts's own comment on
// why that one is public knowledge, not a secret to test against).
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const TEST_PUBLIC_KEY_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const TEST_PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function payload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    licenseKey: "KVL-TEST-0000-0001",
    tier: "ENTERPRISE",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    machineFingerprint: null,
    customerName: "Test Customer",
    maxActivations: 1,
    ...overrides,
  };
}

function signedFile(overrides: Partial<LicensePayload> = {}): SignedLicenseFile {
  const p = payload(overrides);
  return { payload: p, signature: signPayload(p, TEST_PRIVATE_KEY_PEM) };
}

/** Pins evaluateLicense to this test file's own keypair rather than the production default/env-configured one. */
function evaluate(file: SignedLicenseFile, params: Parameters<typeof evaluateLicense>[1], now: Date = new Date()) {
  return evaluateLicense(file, params, now, TEST_PUBLIC_KEY_PEM);
}

describe("canonicalizePayload", () => {
  it("produces the same bytes regardless of property insertion order", () => {
    const a: LicensePayload = payload();
    const b: LicensePayload = { customerName: a.customerName, licenseKey: a.licenseKey, maxActivations: a.maxActivations, tier: a.tier, issuedAt: a.issuedAt, expiresAt: a.expiresAt, machineFingerprint: a.machineFingerprint };
    expect(canonicalizePayload(a)).toBe(canonicalizePayload(b));
  });
});

describe("signPayload / verifySignature", () => {
  it("verifies a signature produced by the matching private key", () => {
    const p = payload();
    const signature = signPayload(p, TEST_PRIVATE_KEY_PEM);
    expect(verifySignature(p, signature, TEST_PUBLIC_KEY_PEM)).toBe(true);
  });

  it("rejects a signature verified against a different public key", () => {
    const other = crypto.generateKeyPairSync("ed25519");
    const otherPublicPem = other.publicKey.export({ type: "spki", format: "pem" }).toString();
    const p = payload();
    const signature = signPayload(p, TEST_PRIVATE_KEY_PEM);
    expect(verifySignature(p, signature, otherPublicPem)).toBe(false);
  });

  it("rejects a signature when the payload was tampered with after signing", () => {
    const p = payload();
    const signature = signPayload(p, TEST_PRIVATE_KEY_PEM);
    const tampered = { ...p, tier: "AGENCY" as const };
    expect(verifySignature(tampered, signature, TEST_PUBLIC_KEY_PEM)).toBe(false);
  });

  it("returns false (not throw) for garbage signature input", () => {
    expect(verifySignature(payload(), "not-base64-signature-data", TEST_PUBLIC_KEY_PEM)).toBe(false);
  });
});

describe("parseLicenseFile", () => {
  it("parses a well-formed signed license file", () => {
    const file = signedFile();
    const parsed = parseLicenseFile(JSON.stringify(file));
    expect(parsed.payload.licenseKey).toBe("KVL-TEST-0000-0001");
    expect(parsed.signature).toBe(file.signature);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseLicenseFile("not json")).toThrow(/not valid JSON/);
  });

  it("throws when the tier is invalid", () => {
    const file = signedFile();
    const bad = JSON.stringify({ ...file, payload: { ...file.payload, tier: "GOLD" } });
    expect(() => parseLicenseFile(bad)).toThrow(/invalid tier/);
  });

  it("throws when a required field is missing", () => {
    const file = signedFile();
    const { customerName: _drop, ...rest } = file.payload;
    const bad = JSON.stringify({ ...file, payload: rest });
    expect(() => parseLicenseFile(bad)).toThrow(/customerName/);
  });
});

describe("evaluateLicense", () => {
  it("accepts a valid, unexpired, unbound license on any machine", () => {
    const file = signedFile();
    const verdict = evaluate(file, { currentMachineFingerprint: "machine-a", boundFingerprint: null });
    expect(verdict).toMatchObject({ ok: true, reason: "valid" });
  });

  it("rejects a license with an invalid signature", () => {
    const file = signedFile();
    const tampered: SignedLicenseFile = { ...file, payload: { ...file.payload, tier: "AGENCY" } };
    const verdict = evaluate(tampered, { currentMachineFingerprint: "machine-a", boundFingerprint: null });
    expect(verdict).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  it("rejects an expired license", () => {
    const file = signedFile({ expiresAt: "2020-01-01T00:00:00.000Z" });
    const verdict = evaluate(file, { currentMachineFingerprint: "machine-a", boundFingerprint: null }, new Date("2026-01-01T00:00:00.000Z"));
    expect(verdict).toMatchObject({ ok: false, reason: "expired" });
  });

  it("accepts a not-yet-expired license", () => {
    const file = signedFile({ expiresAt: "2030-01-01T00:00:00.000Z" });
    const verdict = evaluate(file, { currentMachineFingerprint: "machine-a", boundFingerprint: null }, new Date("2026-01-01T00:00:00.000Z"));
    expect(verdict.ok).toBe(true);
  });

  it("accepts a license on the machine it's bound to", () => {
    const file = signedFile();
    const verdict = evaluate(file, { currentMachineFingerprint: "machine-a", boundFingerprint: "machine-a" });
    expect(verdict.ok).toBe(true);
  });

  it("rejects a license bound to a different machine", () => {
    const file = signedFile();
    const verdict = evaluate(file, { currentMachineFingerprint: "machine-b", boundFingerprint: "machine-a" });
    expect(verdict).toMatchObject({ ok: false, reason: "machine_mismatch" });
  });

  it("checks signature before expiry before machine binding (fail-fast on the least-trustworthy field first)", () => {
    // Tampered AND expired AND wrong machine — must report invalid_signature,
    // not one of the others, since none of the payload's other fields can be
    // trusted once the signature itself doesn't verify.
    const file = signedFile({ expiresAt: "2020-01-01T00:00:00.000Z" });
    const tampered: SignedLicenseFile = { ...file, payload: { ...file.payload, machineFingerprint: "machine-a" } };
    const verdict = evaluate(tampered, { currentMachineFingerprint: "machine-b", boundFingerprint: "machine-a" }, new Date("2026-01-01T00:00:00.000Z"));
    expect(verdict.reason).toBe("invalid_signature");
  });
});
