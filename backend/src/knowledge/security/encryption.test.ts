import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt } from "./encryption";

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("encrypt / decrypt", () => {
  it("round-trips plaintext exactly", () => {
    const plaintext = "This is sensitive user search query text.";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("round-trips unicode content correctly", () => {
    const plaintext = "मुझे रिफंड चाहिए, bhai kab milega yaar?";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("round-trips empty string", () => {
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", () => {
    const a = encrypt("same plaintext");
    const b = encrypt("same plaintext");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same plaintext");
    expect(decrypt(b)).toBe("same plaintext");
  });

  it("throws when ENCRYPTION_KEY is not set", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt("text")).toThrow();
  });

  it("throws when ENCRYPTION_KEY is the wrong length", () => {
    process.env.ENCRYPTION_KEY = "abcd"; // way too short to be a 32-byte hex key
    expect(() => encrypt("text")).toThrow();
  });

  it("throws (rather than silently returning corrupted data) when the ciphertext is tampered with", () => {
    const payload = encrypt("original message");
    const raw = Buffer.from(payload, "base64");
    raw[raw.length - 1] ^= 0xff; // flip a byte in the ciphertext
    const tampered = raw.toString("base64");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("fails to decrypt with a different key than the one used to encrypt", () => {
    const payload = encrypt("secret");
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex"); // swap to a different key
    expect(() => decrypt(payload)).toThrow();
  });
});
