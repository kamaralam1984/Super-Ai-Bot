import { describe, it, expect } from "vitest";
import {
  embedText,
  embedTexts,
  cosineSimilarity,
  currentEmbeddingMeta,
  isEmbeddingStale,
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
  EMBEDDING_DIMENSIONS,
} from "./embeddings";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });
});

describe("currentEmbeddingMeta / isEmbeddingStale", () => {
  it("reports the active model and version", () => {
    expect(currentEmbeddingMeta()).toEqual({ model: EMBEDDING_MODEL, version: EMBEDDING_VERSION });
  });

  it("is not stale when model and version match", () => {
    expect(isEmbeddingStale(EMBEDDING_MODEL, EMBEDDING_VERSION)).toBe(false);
  });

  it("is stale when the model differs", () => {
    expect(isEmbeddingStale("some-other-model", EMBEDDING_VERSION)).toBe(true);
  });

  it("is stale when the version is behind", () => {
    expect(isEmbeddingStale(EMBEDDING_MODEL, EMBEDDING_VERSION - 1)).toBe(true);
  });

  it("is stale when there is no prior embedding metadata at all", () => {
    expect(isEmbeddingStale(null, null)).toBe(true);
    expect(isEmbeddingStale(undefined, undefined)).toBe(true);
  });
});

describe("embedText / embedTexts (real local model inference)", () => {
  it("produces a vector of the documented dimensionality", async () => {
    const vector = await embedText("Our support team is available 24/7.");
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  }, 30000);

  it("gives semantically similar sentences a higher cosine similarity than unrelated ones", async () => {
    const a = await embedText("What are your business hours?");
    const b = await embedText("When is your store open?");
    const c = await embedText("The quarterly revenue report is attached.");

    const related = cosineSimilarity(a, b);
    const unrelated = cosineSimilarity(a, c);
    expect(related).toBeGreaterThan(unrelated);
  }, 30000);

  it("returns an empty array for empty input without calling the model", async () => {
    expect(await embedTexts([])).toEqual([]);
  });

  it("produces embeddings for concurrent batches that match sequential single-item embedding (no cross-item contamination)", async () => {
    const texts = [
      "Hi.",
      "This is a much longer sentence deliberately included to create a large padding gap against the short one in the same concurrent group.",
      "Contact our sales team for a custom quote.",
      "Refunds are processed within 5-7 business days.",
    ];

    const batched = await embedTexts(texts, { concurrency: 4 });
    expect(batched).toHaveLength(texts.length);

    for (let i = 0; i < texts.length; i++) {
      const solo = await embedText(texts[i]);
      expect(cosineSimilarity(batched[i], solo)).toBeGreaterThan(0.999);
    }
  }, 30000);

  it("reports progress as groups complete", async () => {
    const calls: Array<[number, number]> = [];
    await embedTexts(["one", "two", "three", "four", "five"], {
      concurrency: 2,
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1]).toEqual([5, 5]);
  }, 30000);
});
