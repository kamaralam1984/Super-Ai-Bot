import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sealCredential, openCredential, rotateCredential, credentialsMatch, getSecretsCipher, setSecretsCipher, resetSecretsCipher, Aes256GcmCipher } from "./credentialVault";
import type { SecretsCipher } from "./credentialVault";
import type { RawCredentialInput } from "../types";

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("credentialVault", () => {
  it("round-trips an API key credential", () => {
    const input: RawCredentialInput = { authMethod: "API_KEY", apiKey: "sk_live_abc123" };
    const vaulted = sealCredential(input);
    expect(vaulted.encryptedPayload).not.toContain("sk_live_abc123");
    expect(openCredential(vaulted)).toEqual(input);
  });

  it("round-trips a Basic Auth credential", () => {
    const input: RawCredentialInput = { authMethod: "BASIC_AUTH", basicAuth: { username: "wc_key", password: "wc_secret" } };
    const vaulted = sealCredential(input);
    expect(vaulted.encryptedPayload).not.toContain("wc_secret");
    expect(openCredential(vaulted)).toEqual(input);
  });

  it("never stores the raw secret in the fingerprint", () => {
    const input: RawCredentialInput = { authMethod: "BEARER_TOKEN", bearerToken: "super-secret-token-value" };
    const vaulted = sealCredential(input);
    expect(vaulted.fingerprint).not.toContain("super-secret-token-value");
    expect(vaulted.fingerprint).toHaveLength(64); // sha256 hex digest
  });

  it("produces the same fingerprint for the same secret material", () => {
    const a = sealCredential({ authMethod: "API_KEY", apiKey: "same-key" });
    const b = sealCredential({ authMethod: "API_KEY", apiKey: "same-key" });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.encryptedPayload).not.toBe(b.encryptedPayload); // different IV each time
  });

  it("throws when a required secret is missing", () => {
    expect(() => sealCredential({ authMethod: "API_KEY" })).toThrow();
    expect(() => sealCredential({ authMethod: "BEARER_TOKEN" })).toThrow();
  });

  it("allows NONE auth with no secret material", () => {
    const vaulted = sealCredential({ authMethod: "NONE" });
    expect(openCredential(vaulted)).toEqual({ authMethod: "NONE" });
  });

  it("rotateCredential re-encrypts under a fresh IV without changing the fingerprint", () => {
    const original = sealCredential({ authMethod: "JWT", jwt: "header.payload.signature" });
    const rotated = rotateCredential(original);
    expect(rotated.fingerprint).toBe(original.fingerprint);
    expect(rotated.encryptedPayload).not.toBe(original.encryptedPayload);
    expect(openCredential(rotated)).toEqual({ authMethod: "JWT", jwt: "header.payload.signature" });
  });

  it("credentialsMatch detects identical secret material regardless of encoding", () => {
    const a: RawCredentialInput = { authMethod: "CUSTOM_HEADER", customHeaders: { "X-Foo": "bar" } };
    const b: RawCredentialInput = { authMethod: "CUSTOM_HEADER", customHeaders: { "X-Foo": "bar" } };
    const c: RawCredentialInput = { authMethod: "CUSTOM_HEADER", customHeaders: { "X-Foo": "baz" } };
    expect(credentialsMatch(a, b)).toBe(true);
    expect(credentialsMatch(a, c)).toBe(false);
  });

  it("credentialsMatch returns false for different auth methods even with equal-looking material", () => {
    const a: RawCredentialInput = { authMethod: "API_KEY", apiKey: "x" };
    const b: RawCredentialInput = { authMethod: "BEARER_TOKEN", bearerToken: "x" };
    expect(credentialsMatch(a, b)).toBe(false);
  });

  it("openCredential throws if the payload was tampered with", () => {
    const vaulted = sealCredential({ authMethod: "API_KEY", apiKey: "tamper-test" });
    const raw = Buffer.from(vaulted.encryptedPayload, "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => openCredential({ encryptedPayload: raw.toString("base64") })).toThrow();
  });
});

describe("HSM-readiness seam (SecretsCipher)", () => {
  afterEach(() => {
    resetSecretsCipher();
  });

  it("defaults to the AES-256-GCM software cipher", () => {
    expect(getSecretsCipher()).toBeInstanceOf(Aes256GcmCipher);
    expect(getSecretsCipher().name).toBe("aes-256-gcm-software");
  });

  it("routes sealCredential/openCredential through a swapped-in cipher", () => {
    let encryptCalls = 0;
    let decryptCalls = 0;
    const fakeHsmCipher: SecretsCipher = {
      name: "fake-hsm",
      encrypt: (plaintext) => {
        encryptCalls++;
        return Buffer.from(plaintext, "utf-8").toString("base64");
      },
      decrypt: (ciphertext) => {
        decryptCalls++;
        return Buffer.from(ciphertext, "base64").toString("utf-8");
      },
    };
    setSecretsCipher(fakeHsmCipher);

    const input: RawCredentialInput = { authMethod: "API_KEY", apiKey: "sk_live_abc123" };
    const vaulted = sealCredential(input);
    expect(encryptCalls).toBe(1);
    expect(openCredential(vaulted)).toEqual(input);
    expect(decryptCalls).toBe(1);
    expect(getSecretsCipher().name).toBe("fake-hsm");
  });

  it("resetSecretsCipher restores the default AES-256-GCM cipher", () => {
    setSecretsCipher({ name: "fake-hsm", encrypt: (p) => p, decrypt: (c) => c });
    resetSecretsCipher();
    expect(getSecretsCipher()).toBeInstanceOf(Aes256GcmCipher);
  });

  it("a payload sealed under one cipher cannot be silently opened by a different one (no plaintext leak across ciphers)", () => {
    const vaulted = sealCredential({ authMethod: "API_KEY", apiKey: "real-secret" });
    setSecretsCipher({ name: "fake-hsm", encrypt: (p) => p, decrypt: (c) => c }); // a no-op "cipher" that just returns its input
    // The fake cipher's decrypt() is a no-op, so this returns the still-AES-encrypted
    // base64 payload as "plaintext" — which is not valid JSON, proving the swap
    // didn't somehow retroactively make the old ciphertext readable.
    expect(() => openCredential(vaulted)).toThrow();
  });
});
