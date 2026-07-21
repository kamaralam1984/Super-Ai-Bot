import { describe, it, expect } from "vitest";
import { runQualityChecks } from "./qualityValidator";
import type { ChunkForQualityCheck, RelationshipForQualityCheck } from "./qualityValidator";

function chunk(overrides: Partial<ChunkForQualityCheck>): ChunkForQualityCheck {
  return { id: "c1", content: "Real content here.", category: "Company", confidenceScore: 0.8, isDuplicate: false, duplicateOfChunkId: null, ...overrides };
}

describe("runQualityChecks", () => {
  it("returns no issues for a clean, healthy knowledge base", () => {
    const issues = runQualityChecks({ chunks: [chunk({})], relationships: [], knownEntityIds: {} });
    expect(issues).toHaveLength(0);
  });

  it("flags a completely empty knowledge base as missing knowledge", () => {
    const issues = runQualityChecks({ chunks: [], relationships: [], knownEntityIds: {} });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "error", code: "missing_knowledge" }));
  });

  it("flags an empty-content chunk", () => {
    const issues = runQualityChecks({ chunks: [chunk({ content: "   " })], relationships: [], knownEntityIds: {} });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "error", code: "empty_chunk", entityId: "c1" }));
  });

  it("flags an out-of-range confidence score as invalid, not merely low", () => {
    const issues = runQualityChecks({ chunks: [chunk({ confidenceScore: 1.5 })], relationships: [], knownEntityIds: {} });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "error", code: "invalid_confidence" }));
    expect(issues.find((i) => i.code === "low_confidence")).toBeUndefined();
  });

  it("flags a negative confidence score as invalid", () => {
    const issues = runQualityChecks({ chunks: [chunk({ confidenceScore: -0.1 })], relationships: [], knownEntityIds: {} });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "error", code: "invalid_confidence" }));
  });

  it("flags a below-floor (but valid) confidence score as a warning", () => {
    const issues = runQualityChecks({ chunks: [chunk({ confidenceScore: 0.1 })], relationships: [], knownEntityIds: {} });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "warning", code: "low_confidence" }));
  });

  it("respects a custom confidence floor", () => {
    const issues = runQualityChecks({ chunks: [chunk({ confidenceScore: 0.5 })], relationships: [], knownEntityIds: {}, confidenceFloor: 0.6 });
    expect(issues).toContainEqual(expect.objectContaining({ code: "low_confidence" }));
  });

  it("flags a missing category as a warning", () => {
    const issues = runQualityChecks({ chunks: [chunk({ category: null })], relationships: [], knownEntityIds: {} });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "warning", code: "missing_category" }));
  });

  it("flags a duplicate chunk with no canonical pointer", () => {
    const issues = runQualityChecks({ chunks: [chunk({ isDuplicate: true, duplicateOfChunkId: null })], relationships: [], knownEntityIds: {} });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "error", code: "broken_duplicate_reference" }));
  });

  it("flags a chunk marked as a duplicate of itself", () => {
    const issues = runQualityChecks({ chunks: [chunk({ id: "c1", isDuplicate: true, duplicateOfChunkId: "c1" })], relationships: [], knownEntityIds: {} });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "error", code: "self_referential_duplicate" }));
  });

  it("flags a duplicateOfChunkId pointing to a nonexistent chunk", () => {
    const issues = runQualityChecks({ chunks: [chunk({ id: "c1", isDuplicate: true, duplicateOfChunkId: "does-not-exist" })], relationships: [], knownEntityIds: {} });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "error", code: "broken_reference" }));
  });

  it("does not flag a valid duplicate pointing to a real canonical chunk", () => {
    const issues = runQualityChecks({
      chunks: [chunk({ id: "c1" }), chunk({ id: "c2", isDuplicate: true, duplicateOfChunkId: "c1" })],
      relationships: [],
      knownEntityIds: {},
    });
    expect(issues.filter((i) => i.entityId === "c2")).toHaveLength(0);
  });

  it("flags a relationship whose source no longer exists", () => {
    const rel: RelationshipForQualityCheck = { id: "r1", sourceType: "Product", sourceId: "deleted-product", targetType: "Category", targetId: "Electronics" };
    const issues = runQualityChecks({ chunks: [], relationships: [rel], knownEntityIds: { Product: new Set(["p1", "p2"]) } });
    expect(issues.some((i) => i.code === "broken_relationship" && i.entityId === "r1")).toBe(true);
  });

  it("flags a relationship whose target no longer exists", () => {
    const rel: RelationshipForQualityCheck = { id: "r1", sourceType: "Faq", sourceId: "f1", targetType: "Product", targetId: "deleted-product" };
    const issues = runQualityChecks({ chunks: [], relationships: [rel], knownEntityIds: { Faq: new Set(["f1"]), Product: new Set(["p1"]) } });
    expect(issues.some((i) => i.code === "broken_relationship")).toBe(true);
  });

  it("never flags a Category target/source as broken (categories are bare labels, not entities with an id set)", () => {
    const rel: RelationshipForQualityCheck = { id: "r1", sourceType: "Product", sourceId: "p1", targetType: "Category", targetId: "Electronics" };
    const issues = runQualityChecks({ chunks: [chunk({})], relationships: [rel], knownEntityIds: { Product: new Set(["p1"]) } });
    expect(issues).toHaveLength(0);
  });

  it("does not flag a relationship whose endpoints both exist", () => {
    const rel: RelationshipForQualityCheck = { id: "r1", sourceType: "Faq", sourceId: "f1", targetType: "Product", targetId: "p1" };
    const issues = runQualityChecks({ chunks: [], relationships: [rel], knownEntityIds: { Faq: new Set(["f1"]), Product: new Set(["p1"]) } });
    expect(issues.filter((i) => i.code === "broken_relationship")).toHaveLength(0);
  });
});
