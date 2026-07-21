import { describe, it, expect } from "vitest";
import { planVersionUpdate, planRollback, planTrainingRunRollback, type VersionedChunkState, type VersionRecord, type TrainingRunChunkState } from "./versionManager";

describe("planVersionUpdate", () => {
  const current: VersionedChunkState = { version: 1, content: "Our refund window is 30 days.", embedding: [1, 0], confidenceScore: 0.9 };

  it("reports no change and no archived version when content is identical", () => {
    const decision = planVersionUpdate(current, { content: "Our refund window is 30 days.", embedding: [1, 0], confidenceScore: 0.9 });
    expect(decision.changed).toBe(false);
    expect(decision.archivedVersion).toBeUndefined();
    expect(decision.nextVersion).toBe(1);
  });

  it("treats whitespace/case-only differences as unchanged (same normalized hash)", () => {
    const decision = planVersionUpdate(current, { content: "our refund window is 30 days.  ", embedding: [1, 0], confidenceScore: 0.9 });
    expect(decision.changed).toBe(false);
  });

  it("archives the current state and bumps the version when content genuinely changed", () => {
    const decision = planVersionUpdate(current, { content: "Our refund window is now 45 days.", embedding: [0.9, 0.1], confidenceScore: 0.85 }, "recrawl detected a content change");
    expect(decision.changed).toBe(true);
    expect(decision.nextVersion).toBe(2);
    expect(decision.archivedVersion).toEqual({
      version: 1,
      content: "Our refund window is 30 days.",
      embedding: [1, 0],
      confidenceScore: 0.9,
      changeReason: "recrawl detected a content change",
    });
  });

  it("uses a sensible default changeReason when none is given", () => {
    const decision = planVersionUpdate(current, { content: "Completely different content.", embedding: [0, 1], confidenceScore: 0.5 });
    expect(decision.archivedVersion?.changeReason).toBe("source content changed on recrawl");
  });
});

describe("planRollback", () => {
  const current: VersionedChunkState = { version: 3, content: "Version 3 content", embedding: [0, 0, 1], confidenceScore: 0.7 };
  const history: VersionRecord[] = [
    { version: 1, content: "Version 1 content", embedding: [1, 0, 0], confidenceScore: 0.9 },
    { version: 2, content: "Version 2 content", embedding: [0, 1, 0], confidenceScore: 0.8 },
  ];

  it("restores the target version's content/embedding/confidence", () => {
    const plan = planRollback(current, history, 1);
    expect(plan.restoredContent).toBe("Version 1 content");
    expect(plan.restoredEmbedding).toEqual([1, 0, 0]);
    expect(plan.restoredConfidenceScore).toBe(0.9);
  });

  it("archives the pre-rollback live state as a brand new version rather than deleting history", () => {
    const plan = planRollback(current, history, 1);
    expect(plan.archivedVersion).toEqual({
      version: 3,
      content: "Version 3 content",
      embedding: [0, 0, 1],
      confidenceScore: 0.7,
      changeReason: "rolled back to version 1",
    });
    expect(plan.nextVersion).toBe(4); // forward-only: continues past 3, doesn't reuse version 1 or 2
  });

  it("throws when rolling back to the version that's already live", () => {
    expect(() => planRollback(current, history, 3)).toThrow();
  });

  it("throws when the target version doesn't exist in history", () => {
    expect(() => planRollback(current, history, 99)).toThrow();
  });
});

describe("planTrainingRunRollback", () => {
  it("restores an updated chunk to its pre-run archived state", () => {
    const states: TrainingRunChunkState[] = [
      {
        chunkId: "chunk-updated",
        version: 2,
        content: "New price: $50",
        embedding: [0.5, 0.5],
        confidenceScore: 0.9,
        archivedDuringRun: { version: 1, content: "Old price: $40", embedding: [0.1, 0.1], confidenceScore: 0.85 },
      },
    ];
    const plan = planTrainingRunRollback("crawl-job-1", states);
    expect(plan.restoredCount).toBe(1);
    expect(plan.deletedCount).toBe(0);
    expect(plan.actions).toEqual([
      {
        chunkId: "chunk-updated",
        kind: "restored",
        restoredContent: "Old price: $40",
        restoredEmbedding: [0.1, 0.1],
        restoredConfidenceScore: 0.85,
        archivedVersion: { version: 2, content: "New price: $50", embedding: [0.5, 0.5], confidenceScore: 0.9, changeReason: "rolled back to version 1" },
        nextVersion: 3,
      },
    ]);
  });

  it("deletes a chunk the run newly created (no prior archived state)", () => {
    const states: TrainingRunChunkState[] = [{ chunkId: "chunk-new", version: 1, content: "Brand new content", embedding: [1, 0], confidenceScore: 0.7 }];
    const plan = planTrainingRunRollback("crawl-job-1", states);
    expect(plan.restoredCount).toBe(0);
    expect(plan.deletedCount).toBe(1);
    expect(plan.actions).toEqual([{ chunkId: "chunk-new", kind: "deleted" }]);
  });

  it("handles a mixed run: some chunks restored, some deleted", () => {
    const states: TrainingRunChunkState[] = [
      { chunkId: "updated-1", version: 2, content: "updated", embedding: [0, 1], confidenceScore: 0.8, archivedDuringRun: { version: 1, content: "original", embedding: [1, 1], confidenceScore: 0.75 } },
      { chunkId: "created-1", version: 1, content: "brand new", embedding: [1, 0], confidenceScore: 0.6 },
      { chunkId: "created-2", version: 1, content: "also new", embedding: [0, 0], confidenceScore: 0.6 },
    ];
    const plan = planTrainingRunRollback("crawl-job-2", states);
    expect(plan.restoredCount).toBe(1);
    expect(plan.deletedCount).toBe(2);
    expect(plan.actions.map((a) => a.chunkId)).toEqual(["updated-1", "created-1", "created-2"]);
  });

  it("returns an empty plan when the run touched no chunks", () => {
    const plan = planTrainingRunRollback("crawl-job-empty", []);
    expect(plan).toEqual({ crawlJobId: "crawl-job-empty", actions: [], restoredCount: 0, deletedCount: 0 });
  });
});
