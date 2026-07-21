import { describe, it, expect } from "vitest";
import { TtlCache } from "./queryCache";

describe("TtlCache", () => {
  it("returns undefined for a missing key", () => {
    const cache = new TtlCache<string>(1000);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("returns a stored value before it expires", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("q", "answer", 1000);
    expect(cache.get("q", 1500)).toBe("answer");
  });

  it("expires a value once its TTL has passed", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("q", "answer", 1000);
    expect(cache.get("q", 2001)).toBeUndefined();
  });

  it("evicts the oldest entry once maxEntries is exceeded", () => {
    const cache = new TtlCache<string>(10_000, 2);
    cache.set("a", "1", 1000);
    cache.set("b", "2", 1000);
    cache.set("c", "3", 1000); // should evict "a"
    expect(cache.get("a", 1000)).toBeUndefined();
    expect(cache.get("b", 1000)).toBe("2");
    expect(cache.get("c", 1000)).toBe("3");
    expect(cache.size).toBe(2);
  });

  it("has() reflects expiry correctly", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("q", "answer", 1000);
    expect(cache.has("q", 1500)).toBe(true);
    expect(cache.has("q", 2001)).toBe(false);
  });

  it("clear() removes everything", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
