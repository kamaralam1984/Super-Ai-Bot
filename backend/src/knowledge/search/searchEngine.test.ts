import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { keywordSearch, fuseRankings, search, type SearchCandidate } from "./searchEngine";
import { VectorStore } from "../vector/vectorStore";
import { embedText } from "../embed/embeddings";

describe("keywordSearch (real BM25)", () => {
  const candidates: SearchCandidate[] = [
    { chunkId: "refund", content: "You can request a refund within 30 days of purchase." },
    { chunkId: "shipping", content: "Shipping takes 5 to 7 business days for domestic orders." },
    { chunkId: "refund-shipping", content: "Refund for shipping fees is only issued if the order never arrived." },
    { chunkId: "unrelated", content: "Our headquarters is located in downtown Springfield." },
  ];

  it("returns an empty array for an empty query or empty candidates", () => {
    expect(keywordSearch("", candidates, 5)).toEqual([]);
    expect(keywordSearch("refund", [], 5)).toEqual([]);
  });

  it("ranks documents containing the query term above ones that don't", () => {
    const results = keywordSearch("refund", candidates, 5);
    const ids = results.map((r) => r.chunkId);
    expect(ids).toContain("refund");
    expect(ids).toContain("refund-shipping");
    expect(ids).not.toContain("unrelated");
  });

  it("is case-insensitive", () => {
    const lower = keywordSearch("refund", candidates, 5);
    const upper = keywordSearch("REFUND", candidates, 5);
    expect(upper.map((r) => r.chunkId)).toEqual(lower.map((r) => r.chunkId));
  });

  it("scores a two-term match higher than the same document scored on one term alone would predict, without crashing on unknown terms", () => {
    const results = keywordSearch("refund shipping zzzznotaword", candidates, 5);
    expect(results[0].chunkId).toBe("refund-shipping");
  });

  it("respects the k limit", () => {
    const results = keywordSearch("refund shipping order", candidates, 1);
    expect(results).toHaveLength(1);
  });
});

describe("fuseRankings (Reciprocal Rank Fusion)", () => {
  it("ranks a chunk that appears near the top of both lists above one appearing in only one list", () => {
    const semantic = [
      { chunkId: "a", score: 0.9, semanticScore: 0.9 },
      { chunkId: "b", score: 0.8, semanticScore: 0.8 },
    ];
    const keyword = [
      { chunkId: "a", score: 5, keywordScore: 5 },
      { chunkId: "c", score: 4, keywordScore: 4 },
    ];
    const fused = fuseRankings([semantic, keyword], 5);
    expect(fused[0].chunkId).toBe("a");
    expect(fused.map((r) => r.chunkId)).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("preserves both semanticScore and keywordScore on a chunk found by both passes", () => {
    const semantic = [{ chunkId: "a", score: 0.9, semanticScore: 0.9 }];
    const keyword = [{ chunkId: "a", score: 5, keywordScore: 5 }];
    const [top] = fuseRankings([semantic, keyword], 5);
    expect(top.semanticScore).toBe(0.9);
    expect(top.keywordScore).toBe(5);
  });

  it("respects the k limit", () => {
    const list = [
      { chunkId: "a", score: 1 },
      { chunkId: "b", score: 1 },
      { chunkId: "c", score: 1 },
    ];
    expect(fuseRankings([list], 2)).toHaveLength(2);
  });
});

describe("search() end-to-end with a real VectorStore and real embeddings", () => {
  let tmpDir: string;
  let store: VectorStore;
  const NAMESPACE = "test-install";

  const corpus: SearchCandidate[] = [
    { chunkId: "hours", content: "Our store is open Monday through Friday from 9am to 6pm." },
    { chunkId: "returns", content: "You may return any item within 30 days for a full refund." },
    { chunkId: "location", content: "We are headquartered in downtown Springfield." },
  ];

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "search-engine-test-"));
    store = new VectorStore(tmpDir);
    const vectors = await Promise.all(corpus.map((c) => embedText(c.content)));
    store.upsertMany(
      NAMESPACE,
      corpus.map((c, i) => ({ chunkId: c.chunkId, vector: vectors[i] }))
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keyword mode finds an exact term match", async () => {
    const queryVector = await embedText("refund policy");
    const results = search({ vectorStore: store, namespace: NAMESPACE, queryVector, query: "refund", candidates: corpus, k: 3, mode: "keyword" });
    expect(results[0].chunkId).toBe("returns");
  }, 30000);

  it("semantic mode finds a paraphrased match with no shared keywords", async () => {
    const queryVector = await embedText("What time do you close?");
    const results = search({ vectorStore: store, namespace: NAMESPACE, queryVector, query: "What time do you close?", candidates: corpus, k: 3, mode: "semantic" });
    expect(results[0].chunkId).toBe("hours");
  }, 30000);

  it("hybrid mode surfaces the semantic match even when the query shares no keywords with it", async () => {
    const queryText = "When do you close for the day?";
    const queryVector = await embedText(queryText);
    const results = search({ vectorStore: store, namespace: NAMESPACE, queryVector, query: queryText, candidates: corpus, k: 3, mode: "hybrid" });
    expect(results[0].chunkId).toBe("hours");
  }, 30000);

  it("filterChunkIds narrows results in both semantic and keyword passes", async () => {
    const queryVector = await embedText("refund policy");
    const results = search({
      vectorStore: store,
      namespace: NAMESPACE,
      queryVector,
      query: "refund",
      candidates: corpus,
      k: 3,
      mode: "hybrid",
      filterChunkIds: new Set(["hours", "location"]), // deliberately excludes "returns"
    });
    expect(results.map((r) => r.chunkId)).not.toContain("returns");
  }, 30000);
});
