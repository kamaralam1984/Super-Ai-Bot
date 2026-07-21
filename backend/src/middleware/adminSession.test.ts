import { describe, it, expect, beforeAll } from "vitest";
import { createSessionToken, verifySessionToken } from "./adminSession";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-for-admin-session-tests-only";
});

describe("createSessionToken / verifySessionToken", () => {
  it("issues a token that verifies as a valid admin session", async () => {
    const token = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
  });

  it("rejects a garbage token", async () => {
    expect(await verifySessionToken("not-a-real-jwt")).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken();
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "a-completely-different-secret-value-here";
    try {
      expect(await verifySessionToken(token)).toBe(false);
    } finally {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  it("rejects an empty string", async () => {
    expect(await verifySessionToken("")).toBe(false);
  });
});
