import { describe, it, expect } from "vitest";
import { planIncrementalTraining } from "./incrementalTrainer";

describe("planIncrementalTraining", () => {
  it("returns a full-rebuild plan when there's no previous crawl to diff against", () => {
    const plan = planIncrementalTraining({
      previousPages: [],
      currentPages: [{ url: "https://example.com/a", contentHash: "h1" }],
      existingChunks: [],
    });
    expect(plan.isIncremental).toBe(false);
    expect(plan.allowedUrls).toBeUndefined();
    expect(plan.chunkIdsToRemove).toEqual([]);
    expect(plan.summary.newCount).toBe(1);
  });

  it("restricts allowedUrls to just the new+modified pages, excluding unchanged ones", () => {
    const plan = planIncrementalTraining({
      previousPages: [
        { url: "https://example.com/unchanged", contentHash: "h1" },
        { url: "https://example.com/modified", contentHash: "h2-old" },
      ],
      currentPages: [
        { url: "https://example.com/unchanged", contentHash: "h1" },
        { url: "https://example.com/modified", contentHash: "h2-new" },
        { url: "https://example.com/brand-new", contentHash: "h3" },
      ],
      existingChunks: [],
    });
    expect(plan.isIncremental).toBe(true);
    expect([...plan.allowedUrls!].sort()).toEqual(["https://example.com/brand-new", "https://example.com/modified"]);
    expect(plan.summary).toEqual({ newCount: 1, modifiedCount: 1, unchangedCount: 1, deletedCount: 0 });
  });

  it("computes chunkIdsToRemove for chunks belonging to deleted pages only", () => {
    const plan = planIncrementalTraining({
      previousPages: [
        { url: "https://example.com/staying", contentHash: "h1" },
        { url: "https://example.com/removed", contentHash: "h2" },
      ],
      currentPages: [{ url: "https://example.com/staying", contentHash: "h1" }],
      existingChunks: [
        { chunkId: "c1", sourceUrl: "https://example.com/staying", section: null },
        { chunkId: "c2", sourceUrl: "https://example.com/removed", section: null },
        { chunkId: "c3", sourceUrl: "https://example.com/removed", section: "Intro" },
      ],
    });
    expect(plan.chunkIdsToRemove.sort()).toEqual(["c2", "c3"]);
    expect(plan.summary.deletedCount).toBe(1);
  });

  it("produces an empty allowedUrls set (not full-rebuild) when everything is unchanged", () => {
    const plan = planIncrementalTraining({
      previousPages: [{ url: "https://example.com/a", contentHash: "h1" }],
      currentPages: [{ url: "https://example.com/a", contentHash: "h1" }],
      existingChunks: [],
    });
    expect(plan.isIncremental).toBe(true);
    expect(plan.allowedUrls!.size).toBe(0);
    expect(plan.summary.unchangedCount).toBe(1);
  });
});
