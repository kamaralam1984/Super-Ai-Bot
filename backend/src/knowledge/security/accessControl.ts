import crypto from "node:crypto";

/**
 * Constant-time comparison of a caller-supplied API key against the real
 * secret (the installer's already-provisioned `API_SECRET`) — a naive
 * `===` comparison leaks timing information proportional to how many
 * leading characters match, which is a real, documented attack against
 * secret comparison. `crypto.timingSafeEqual` requires equal-length
 * buffers, so a length mismatch is checked (and rejected) before it, which
 * itself leaks only the fact that lengths differ — not a meaningful signal
 * since key lengths are fixed and public knowledge.
 */
export function verifyApiKey(providedKey: string | undefined | null, expectedKey: string): boolean {
  if (!providedKey) return false;
  const provided = Buffer.from(providedKey, "utf-8");
  const expected = Buffer.from(expectedKey, "utf-8");
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

interface BucketState {
  tokens: number;
  lastRefillAt: number;
}

export interface RateLimiterOptions {
  /** burst capacity — how many requests a client can make instantaneously before being limited */
  maxTokens: number;
  /** sustained rate — tokens regained per second */
  refillPerSecond: number;
}

/**
 * Per-client token-bucket rate limiter for the knowledge search API — caps
 * both burst abuse (maxTokens) and sustained abuse (refillPerSecond)
 * without needing a shared store, since one process serves one
 * self-hosted installation. `now` is an explicit parameter (defaulting to
 * `Date.now()`) purely for deterministic testing — real callers never need
 * to pass it.
 */
export class TokenBucketRateLimiter {
  private buckets = new Map<string, BucketState>();

  constructor(private options: RateLimiterOptions) {}

  /** Returns true and consumes a token if the client has capacity; returns false (and consumes nothing) if the client is currently rate-limited. */
  tryConsume(clientId: string, now: number = Date.now()): boolean {
    let bucket = this.buckets.get(clientId);
    if (!bucket) {
      bucket = { tokens: this.options.maxTokens, lastRefillAt: now };
      this.buckets.set(clientId, bucket);
    }

    const elapsedSeconds = Math.max(0, (now - bucket.lastRefillAt) / 1000);
    bucket.tokens = Math.min(this.options.maxTokens, bucket.tokens + elapsedSeconds * this.options.refillPerSecond);
    bucket.lastRefillAt = now;

    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Drops a client's bucket state — mainly for tests and for bounding memory if client IDs are unbounded (e.g. IP addresses) over a long-running process. */
  reset(clientId: string): void {
    this.buckets.delete(clientId);
  }
}
