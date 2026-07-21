import { describe, it, expect } from "vitest";
import { computeShareTokenExpiry, decideConversationRecovery, generateShareToken, generateVisitorFingerprint, isShareTokenValid, resolveVisitorIdentity } from "./sessionManager";

describe("generateVisitorFingerprint", () => {
  it("produces a valid UUID", () => {
    expect(generateVisitorFingerprint()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("produces distinct values across calls", () => {
    expect(generateVisitorFingerprint()).not.toBe(generateVisitorFingerprint());
  });
});

describe("resolveVisitorIdentity", () => {
  it("trusts a well-formed cookie fingerprint as a returning visitor", () => {
    const fingerprint = generateVisitorFingerprint();
    expect(resolveVisitorIdentity(fingerprint)).toEqual({ fingerprint, isReturning: true });
  });

  it("issues a fresh fingerprint when there is no cookie", () => {
    const identity = resolveVisitorIdentity(undefined);
    expect(identity.isReturning).toBe(false);
    expect(identity.fingerprint).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("issues a fresh fingerprint for a malformed cookie value", () => {
    const identity = resolveVisitorIdentity("not-a-real-uuid");
    expect(identity.isReturning).toBe(false);
  });
});

describe("decideConversationRecovery", () => {
  it("starts new when there is no existing conversation", () => {
    expect(decideConversationRecovery(null).action).toBe("start_new");
  });

  it("starts new when the existing conversation is closed", () => {
    const decision = decideConversationRecovery({ status: "CLOSED", lastMessageAt: new Date() });
    expect(decision.action).toBe("start_new");
  });

  it("resumes a recent ACTIVE conversation", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const lastMessageAt = new Date("2026-01-01T11:55:00Z"); // 5 minutes ago
    expect(decideConversationRecovery({ status: "ACTIVE", lastMessageAt }, now).action).toBe("resume");
  });

  it("starts new once the idle window has passed", () => {
    const now = new Date("2026-01-01T12:31:00Z");
    const lastMessageAt = new Date("2026-01-01T12:00:00Z"); // 31 minutes ago
    expect(decideConversationRecovery({ status: "ACTIVE", lastMessageAt }, now).action).toBe("start_new");
  });

  it("resumes an ESCALATED conversation still within the idle window", () => {
    const now = new Date("2026-01-01T12:10:00Z");
    const lastMessageAt = new Date("2026-01-01T12:00:00Z");
    expect(decideConversationRecovery({ status: "ESCALATED", lastMessageAt }, now).action).toBe("resume");
  });
});

describe("share tokens", () => {
  it("generates a non-empty, URL-safe token", () => {
    const token = generateShareToken();
    expect(token.length).toBeGreaterThan(10);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("computes an expiry 7 days in the future", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expiry = computeShareTokenExpiry(now);
    expect(expiry.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  it("is valid before expiry and invalid after", () => {
    const expiry = new Date("2026-01-08T00:00:00Z");
    expect(isShareTokenValid(expiry, new Date("2026-01-07T00:00:00Z"))).toBe(true);
    expect(isShareTokenValid(expiry, new Date("2026-01-09T00:00:00Z"))).toBe(false);
  });

  it("is invalid when there is no expiry", () => {
    expect(isShareTokenValid(null)).toBe(false);
  });
});
