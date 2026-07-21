interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Small in-process TTL cache for repeated identical search queries — the
 * expensive part of a search (embedding the query, scanning the vector
 * index, scoring every keyword candidate) is redundant work if the same
 * question comes in again within a short window (a support widget's
 * "did you mean" retry, a user re-asking, a flaky client retrying a
 * request). Bounded by `maxEntries` (oldest-inserted evicted first, since
 * `Map` preserves insertion order) so a burst of unique queries can't grow
 * memory unboundedly.
 */
export class TtlCache<T> {
  private entries = new Map<string, CacheEntry<T>>();

  constructor(
    private ttlMs: number,
    private maxEntries: number = 500
  ) {}

  get(key: string, now: number = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, now: number = Date.now()): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }

  has(key: string, now: number = Date.now()): boolean {
    return this.get(key, now) !== undefined;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
