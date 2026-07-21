import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { formatGroundedAnswer, type SearchHit } from "./citationFormatter";
import { VectorStore } from "../vector/vectorStore";
import { embedText } from "../embed/embeddings";
import { search } from "../search/searchEngine";

describe("formatGroundedAnswer", () => {
  it("refuses when there are no hits at all", () => {
    const result = formatGroundedAnswer([]);
    expect(result.answered).toBe(false);
    if (!result.answered) expect(result.reason).toMatch(/no matching content/i);
  });

  it("refuses when the best hit doesn't clear the confidence floor", () => {
    const hits: SearchHit[] = [{ chunkId: "a", content: "Some weakly relevant content.", sourceUrl: "/a", confidenceScore: 0.9, semanticScore: 0.2 }];
    const result = formatGroundedAnswer(hits, { minConfidence: 0.5 });
    expect(result.answered).toBe(false);
  });

  it("answers with a citation when a hit clears the floor", () => {
    const hits: SearchHit[] = [{ chunkId: "a", content: "Our refund policy allows returns within 30 days.", sourceUrl: "/policy", title: "Refund Policy", category: "Policies", confidenceScore: 0.9, semanticScore: 0.8 }];
    const result = formatGroundedAnswer(hits, { minConfidence: 0.5 });
    expect(result.answered).toBe(true);
    if (result.answered) {
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].sourceUrl).toBe("/policy");
      expect(result.sources[0].title).toBe("Refund Policy");
      expect(result.overallConfidence).toBeCloseTo(0.72, 5);
    }
  });

  it("a highly relevant but low-confidence chunk is pulled down by the multiplicative combination", () => {
    const hits: SearchHit[] = [{ chunkId: "a", content: "text", sourceUrl: "/a", confidenceScore: 0.1, semanticScore: 0.95 }];
    const result = formatGroundedAnswer(hits, { minConfidence: 0.5 });
    expect(result.answered).toBe(false);
  });

  it("ranks multiple qualifying sources by combined score, highest first", () => {
    const hits: SearchHit[] = [
      { chunkId: "weak", content: "weak match", sourceUrl: "/weak", confidenceScore: 0.6, semanticScore: 0.6 },
      { chunkId: "strong", content: "strong match", sourceUrl: "/strong", confidenceScore: 0.95, semanticScore: 0.9 },
    ];
    const result = formatGroundedAnswer(hits, { minConfidence: 0.3 });
    expect(result.answered).toBe(true);
    if (result.answered) {
      expect(result.sources[0].chunkId).toBe("strong");
      expect(result.sources[1].chunkId).toBe("weak");
    }
  });

  it("caps the number of cited sources at maxSources", () => {
    const hits: SearchHit[] = Array.from({ length: 5 }, (_, i) => ({
      chunkId: `c${i}`,
      content: `content ${i}`,
      sourceUrl: `/page-${i}`,
      confidenceScore: 0.9,
      semanticScore: 0.9,
    }));
    const result = formatGroundedAnswer(hits, { minConfidence: 0.3, maxSources: 2 });
    expect(result.answered).toBe(true);
    if (result.answered) expect(result.sources).toHaveLength(2);
  });

  it("collapses multiple qualifying chunks from the same page into one citation, keeping the strongest", () => {
    const hits: SearchHit[] = [
      { chunkId: "weaker", content: "weaker chunk from the same page", sourceUrl: "/faq", confidenceScore: 0.7, semanticScore: 0.5 },
      { chunkId: "stronger", content: "stronger chunk from the same page", sourceUrl: "/faq", confidenceScore: 0.9, semanticScore: 0.8 },
    ];
    const result = formatGroundedAnswer(hits, { minConfidence: 0.3 });
    expect(result.answered).toBe(true);
    if (result.answered) {
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].chunkId).toBe("stronger");
    }
  });

  it("truncates a long excerpt and normalizes a BM25-only (keyword mode) relevance score into [0,1)", () => {
    const longContent = "word ".repeat(200).trim();
    const hits: SearchHit[] = [{ chunkId: "a", content: longContent, sourceUrl: "/a", confidenceScore: 1, keywordScore: 8 }];
    const result = formatGroundedAnswer(hits, { minConfidence: 0.1 });
    expect(result.answered).toBe(true);
    if (result.answered) {
      expect(result.sources[0].excerpt.length).toBeLessThan(longContent.length);
      expect(result.sources[0].excerpt.endsWith("...")).toBe(true);
      expect(result.sources[0].relevanceScore).toBeGreaterThan(0);
      expect(result.sources[0].relevanceScore).toBeLessThan(1);
    }
  });
});

describe("formatGroundedAnswer — real end-to-end via searchEngine + VectorStore", () => {
  let tmpDir: string;
  let store: VectorStore;
  const NAMESPACE = "citation-test";

  const corpus = [
    { chunkId: "hours", content: "Our store is open Monday through Friday from 9am to 6pm.", sourceUrl: "/hours", title: "Store Hours", category: "Company", confidenceScore: 0.95 },
    { chunkId: "returns", content: "You may return any item within 30 days for a full refund.", sourceUrl: "/returns", title: "Returns", category: "Policies", confidenceScore: 0.9 },
  ];

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "citation-test-"));
    store = new VectorStore(tmpDir);
    const vectors = await Promise.all(corpus.map((c) => embedText(c.content)));
    store.upsertMany(NAMESPACE, corpus.map((c, i) => ({ chunkId: c.chunkId, vector: vectors[i] })));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces a grounded, cited answer for a real on-topic query", async () => {
    const queryVector = await embedText("What time do you close?");
    const hits = search({ vectorStore: store, namespace: NAMESPACE, queryVector, query: "closing time", candidates: corpus.map((c) => ({ chunkId: c.chunkId, content: c.content })), k: 2, mode: "semantic" });
    const withMeta: SearchHit[] = hits.map((h) => ({ ...corpus.find((c) => c.chunkId === h.chunkId)!, semanticScore: h.semanticScore }));

    const result = formatGroundedAnswer(withMeta);
    expect(result.answered).toBe(true);
    if (result.answered) expect(result.sources[0].sourceUrl).toBe("/hours");
  }, 30000);

  it("refuses for a query with no real match in the knowledge base", async () => {
    const queryVector = await embedText("What is the capital of France?");
    const hits = search({ vectorStore: store, namespace: NAMESPACE, queryVector, query: "capital of France", candidates: corpus.map((c) => ({ chunkId: c.chunkId, content: c.content })), k: 2, mode: "semantic" });
    const withMeta: SearchHit[] = hits.map((h) => ({ ...corpus.find((c) => c.chunkId === h.chunkId)!, semanticScore: h.semanticScore }));

    const result = formatGroundedAnswer(withMeta);
    expect(result.answered).toBe(false);
  }, 30000);
});
