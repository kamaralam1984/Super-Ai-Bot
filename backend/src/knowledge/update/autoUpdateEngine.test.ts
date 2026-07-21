import { describe, it, expect } from "vitest";
import { planKnowledgeUpdate, matchExistingChunk, findChunksToRemove, findStaleEmbeddings, summarizeUpdate, type ExistingChunkRef } from "./autoUpdateEngine";
import { EMBEDDING_MODEL, EMBEDDING_VERSION } from "../embed/embeddings";
import type { RecrawlPlan } from "../../scanner/recrawl/changeDetector";

describe("planKnowledgeUpdate", () => {
  it("combines new and modified URLs into urlsNeedingProcessing", () => {
    const recrawlPlan: RecrawlPlan = { newUrls: ["/new"], modifiedUrls: ["/changed"], unchangedUrls: ["/same"], deletedUrls: ["/gone"] };
    const plan = planKnowledgeUpdate(recrawlPlan);
    expect(plan.urlsNeedingProcessing.sort()).toEqual(["/changed", "/new"]);
    expect(plan.urlsToRemove).toEqual(["/gone"]);
    expect(plan.urlsUnchanged).toEqual(["/same"]);
  });

  it("produces empty arrays when nothing changed", () => {
    const recrawlPlan: RecrawlPlan = { newUrls: [], modifiedUrls: [], unchangedUrls: ["/a", "/b"], deletedUrls: [] };
    const plan = planKnowledgeUpdate(recrawlPlan);
    expect(plan.urlsNeedingProcessing).toEqual([]);
    expect(plan.urlsToRemove).toEqual([]);
  });
});

describe("matchExistingChunk", () => {
  const existing: ExistingChunkRef[] = [
    { chunkId: "c1", sourceUrl: "/pricing", section: "Pricing > Plans" },
    { chunkId: "c2", sourceUrl: "/pricing", section: "Pricing > FAQ" },
    { chunkId: "c3", sourceUrl: "/about", section: null },
  ];

  it("finds a chunk matching the same sourceUrl and section", () => {
    expect(matchExistingChunk(existing, "/pricing", "Pricing > Plans")).toBe("c1");
  });

  it("matches on null section too", () => {
    expect(matchExistingChunk(existing, "/about", null)).toBe("c3");
  });

  it("returns null when no chunk matches that sourceUrl+section combination", () => {
    expect(matchExistingChunk(existing, "/pricing", "Pricing > Enterprise")).toBeNull();
    expect(matchExistingChunk(existing, "/contact", null)).toBeNull();
  });
});

describe("findChunksToRemove", () => {
  it("returns only chunk IDs whose sourceUrl is in the deleted set", () => {
    const existing: ExistingChunkRef[] = [
      { chunkId: "c1", sourceUrl: "/old-page", section: null },
      { chunkId: "c2", sourceUrl: "/old-page", section: "Section A" },
      { chunkId: "c3", sourceUrl: "/still-here", section: null },
    ];
    const toRemove = findChunksToRemove(existing, ["/old-page"]);
    expect(toRemove.sort()).toEqual(["c1", "c2"]);
  });

  it("returns an empty array when nothing was deleted", () => {
    const existing: ExistingChunkRef[] = [{ chunkId: "c1", sourceUrl: "/page", section: null }];
    expect(findChunksToRemove(existing, [])).toEqual([]);
  });
});

describe("findStaleEmbeddings", () => {
  it("flags chunks embedded with a different model or version than the active one", () => {
    const chunks = [
      { chunkId: "current", embeddingModel: EMBEDDING_MODEL, embeddingVersion: EMBEDDING_VERSION },
      { chunkId: "old-model", embeddingModel: "some-other-model", embeddingVersion: EMBEDDING_VERSION },
      { chunkId: "old-version", embeddingModel: EMBEDDING_MODEL, embeddingVersion: EMBEDDING_VERSION - 1 },
      { chunkId: "never-embedded", embeddingModel: null, embeddingVersion: null },
    ];
    const stale = findStaleEmbeddings(chunks);
    expect(stale.sort()).toEqual(["never-embedded", "old-model", "old-version"]);
  });
});

describe("summarizeUpdate", () => {
  it("counts each bucket", () => {
    const plan = { urlsNeedingProcessing: ["/a", "/b"], urlsToRemove: ["/c"], urlsUnchanged: ["/d", "/e", "/f"] };
    const summary = summarizeUpdate(plan, ["chunk1"]);
    expect(summary).toEqual({ toProcess: 2, toRemove: 1, unchanged: 3, staleEmbeddings: 1 });
  });
});
