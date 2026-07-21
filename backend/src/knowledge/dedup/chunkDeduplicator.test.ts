import { describe, it, expect } from "vitest";
import { deduplicate, deduplicateFaqs, contentHash } from "./chunkDeduplicator";
import { embedText } from "../embed/embeddings";

describe("contentHash", () => {
  it("hashes whitespace/case variants of the same text identically", () => {
    expect(contentHash("Hello   World")).toBe(contentHash("hello world"));
    expect(contentHash("  Hello World  ")).toBe(contentHash("Hello World"));
  });

  it("hashes genuinely different content differently", () => {
    expect(contentHash("Hello World")).not.toBe(contentHash("Goodbye World"));
  });
});

describe("deduplicate — exact matching", () => {
  it("keeps unique items as their own singleton clusters", () => {
    const result = deduplicate([
      { id: "a", content: "First unique chunk." },
      { id: "b", content: "Second unique chunk." },
    ]);
    expect(result.canonicalOf.get("a")).toBe("a");
    expect(result.canonicalOf.get("b")).toBe("b");
    expect(result.clusters.size).toBe(2);
  });

  it("clusters byte-identical content together", () => {
    const result = deduplicate([
      { id: "a", content: "Our refund policy allows returns within 30 days." },
      { id: "b", content: "Our refund policy allows returns within 30 days." },
      { id: "c", content: "A completely different sentence." },
    ]);
    expect(result.canonicalOf.get("a")).toBe(result.canonicalOf.get("b"));
    expect(result.canonicalOf.get("c")).not.toBe(result.canonicalOf.get("a"));
    expect(result.clusters.size).toBe(2);
  });

  it("clusters whitespace/case-only variants as exact duplicates", () => {
    const result = deduplicate([
      { id: "a", content: "Contact  us  today." },
      { id: "b", content: "contact us today." },
    ]);
    expect(result.canonicalOf.get("a")).toBe(result.canonicalOf.get("b"));
  });

  it("never drops an item — every input id appears in the result", () => {
    const items = [
      { id: "a", content: "one" },
      { id: "b", content: "one" },
      { id: "c", content: "two" },
    ];
    const result = deduplicate(items);
    for (const item of items) {
      expect(result.canonicalOf.has(item.id)).toBe(true);
    }
  });

  it("picks the longest member of a cluster as canonical", () => {
    const result = deduplicate([
      { id: "short", content: "hi" },
      { id: "short2", content: "hi" },
      { id: "long", content: "hi there, welcome to our support page" },
    ]);
    // "short" and "short2" hash together (exact match); "long" differs and stays its own cluster since there's no embedding to compare.
    const shortCanonical = result.canonicalOf.get("short");
    expect(shortCanonical).toBe(result.canonicalOf.get("short2"));
    expect(result.canonicalOf.get("long")).toBe("long");
  });
});

describe("deduplicate — near-duplicate matching via embeddings", () => {
  it("clusters two different-hash items whose embeddings are above the threshold", () => {
    const result = deduplicate(
      [
        { id: "a", content: "version A", embedding: [1, 0, 0] },
        { id: "b", content: "version B", embedding: [0.999, 0.001, 0] },
      ],
      { nearDuplicateThreshold: 0.95 }
    );
    expect(result.canonicalOf.get("a")).toBe(result.canonicalOf.get("b"));
  });

  it("does not cluster items whose embeddings are below the threshold", () => {
    const result = deduplicate(
      [
        { id: "a", content: "version A", embedding: [1, 0, 0] },
        { id: "b", content: "version B", embedding: [0, 1, 0] },
      ],
      { nearDuplicateThreshold: 0.95 }
    );
    expect(result.canonicalOf.get("a")).not.toBe(result.canonicalOf.get("b"));
  });

  it("clusters near-duplicates transitively (a~b and b~c implies one cluster) even when a and c alone are below threshold", () => {
    // Three unit vectors 15 degrees apart on the same arc: adjacent pairs
    // (a,b) and (b,c) both have cosine similarity cos(15deg) ~= 0.966 (above
    // the 0.95 threshold), but the endpoints (a,c) are 30 degrees apart —
    // cos(30deg) ~= 0.866, below threshold — so only transitivity through b
    // puts all three in one cluster.
    const deg = (d: number) => (d * Math.PI) / 180;
    const a: [number, number] = [Math.cos(deg(0)), Math.sin(deg(0))];
    const b: [number, number] = [Math.cos(deg(15)), Math.sin(deg(15))];
    const c: [number, number] = [Math.cos(deg(30)), Math.sin(deg(30))];

    const result = deduplicate(
      [
        { id: "a", content: "A", embedding: a },
        { id: "b", content: "B", embedding: b },
        { id: "c", content: "C", embedding: c },
      ],
      { nearDuplicateThreshold: 0.95 }
    );
    const canonicalA = result.canonicalOf.get("a");
    expect(canonicalA).toBeDefined();
    expect(result.canonicalOf.get("b")).toBe(canonicalA);
    expect(result.canonicalOf.get("c")).toBe(canonicalA);
    expect(result.clusters.get(canonicalA!)?.sort()).toEqual(["a", "b", "c"]);
  });

  it("does not attempt near-duplicate comparison for items with no embedding", () => {
    const result = deduplicate([
      { id: "a", content: "version A" },
      { id: "b", content: "version B" },
    ]);
    expect(result.canonicalOf.get("a")).not.toBe(result.canonicalOf.get("b"));
  });
});

describe("deduplicateFaqs", () => {
  it("clusters FAQs with identical question+answer text", () => {
    const result = deduplicateFaqs([
      { id: "f1", question: "What are your hours?", answer: "9am to 6pm." },
      { id: "f2", question: "What are your hours?", answer: "9am to 6pm." },
      { id: "f3", question: "How do I return an item?", answer: "Within 30 days." },
    ]);
    expect(result.canonicalOf.get("f1")).toBe(result.canonicalOf.get("f2"));
    expect(result.canonicalOf.get("f3")).not.toBe(result.canonicalOf.get("f1"));
  });
});

describe("deduplicate — real embeddings end-to-end", () => {
  it("clusters two real paraphrased sentences that mean the same thing", async () => {
    const a = "You can return any item within 30 days for a full refund.";
    const b = "Items may be returned for a complete refund within a 30-day window.";
    const c = "Our office is located in downtown Springfield.";

    const [embA, embB, embC] = await Promise.all([embedText(a), embedText(b), embedText(c)]);
    const result = deduplicate([
      { id: "a", content: a, embedding: embA },
      { id: "b", content: b, embedding: embB },
      { id: "c", content: c, embedding: embC },
    ]); // default threshold — empirically calibrated against this exact model, see chunkDeduplicator.ts

    expect(result.canonicalOf.get("a")).toBe(result.canonicalOf.get("b"));
    expect(result.canonicalOf.get("c")).not.toBe(result.canonicalOf.get("a"));
  }, 30000);
});
