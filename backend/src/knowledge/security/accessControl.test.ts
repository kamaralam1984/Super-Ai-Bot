import { describe, it, expect } from "vitest";
import { verifyApiKey, TokenBucketRateLimiter } from "./accessControl";

describe("verifyApiKey", () => {
  const REAL_KEY = "a-very-real-secret-api-key-value";

  it("accepts the correct key", () => {
    expect(verifyApiKey(REAL_KEY, REAL_KEY)).toBe(true);
  });

  it("rejects an incorrect key", () => {
    expect(verifyApiKey("wrong-key", REAL_KEY)).toBe(false);
  });

  it("rejects a key that's a prefix of the real one (common timing-attack shortcut)", () => {
    expect(verifyApiKey(REAL_KEY.slice(0, 10), REAL_KEY)).toBe(false);
  });

  it("rejects null/undefined/empty input", () => {
    expect(verifyApiKey(undefined, REAL_KEY)).toBe(false);
    expect(verifyApiKey(null, REAL_KEY)).toBe(false);
    expect(verifyApiKey("", REAL_KEY)).toBe(false);
  });
});

describe("TokenBucketRateLimiter", () => {
  it("allows requests up to the burst capacity", () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 3, refillPerSecond: 1 });
    const now = 1000;
    expect(limiter.tryConsume("client-a", now)).toBe(true);
    expect(limiter.tryConsume("client-a", now)).toBe(true);
    expect(limiter.tryConsume("client-a", now)).toBe(true);
    expect(limiter.tryConsume("client-a", now)).toBe(false); // 4th immediate request exceeds burst capacity
  });

  it("refills tokens over time at the configured rate", () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 2, refillPerSecond: 1 });
    let now = 1000;
    expect(limiter.tryConsume("client-a", now)).toBe(true);
    expect(limiter.tryConsume("client-a", now)).toBe(true);
    expect(limiter.tryConsume("client-a", now)).toBe(false);

    now += 1000; // 1 second later — 1 token refilled
    expect(limiter.tryConsume("client-a", now)).toBe(true);
    expect(limiter.tryConsume("client-a", now)).toBe(false);
  });

  it("never refills past the burst capacity even after a long idle period", () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 2, refillPerSecond: 1 });
    let now = 1000;
    limiter.tryConsume("client-a", now);
    now += 1000 * 60 * 60; // an hour of idle time
    expect(limiter.tryConsume("client-a", now)).toBe(true);
    expect(limiter.tryConsume("client-a", now)).toBe(true);
    expect(limiter.tryConsume("client-a", now)).toBe(false); // still capped at maxTokens=2, not unboundedly refilled
  });

  it("tracks separate clients independently", () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 1, refillPerSecond: 1 });
    const now = 1000;
    expect(limiter.tryConsume("client-a", now)).toBe(true);
    expect(limiter.tryConsume("client-a", now)).toBe(false);
    expect(limiter.tryConsume("client-b", now)).toBe(true); // a different client isn't affected by client-a's limit
  });

  it("reset() clears a client's bucket state", () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 1, refillPerSecond: 1 });
    const now = 1000;
    limiter.tryConsume("client-a", now);
    expect(limiter.tryConsume("client-a", now)).toBe(false);
    limiter.reset("client-a");
    expect(limiter.tryConsume("client-a", now)).toBe(true);
  });
});
