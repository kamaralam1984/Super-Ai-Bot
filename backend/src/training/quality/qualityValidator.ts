// Quality Validation Engine — post-hoc QC over the PERSISTED, already-
// trained knowledge base (chunks + the new relationship graph), run after
// a training pass completes. Distinct from validate/knowledgeValidator.ts
// (which only ever sees raw pre-chunking input): this module checks the
// output's own internal integrity — dangling references, orphaned
// relationship edges, and metadata that's structurally invalid rather
// than merely "bad content."

import type { QualityIssue } from "../types";

export interface ChunkForQualityCheck {
  id: string;
  content: string;
  category: string | null;
  confidenceScore: number;
  isDuplicate: boolean;
  duplicateOfChunkId: string | null;
}

export interface RelationshipForQualityCheck {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
}

export interface QualityCheckInput {
  chunks: ChunkForQualityCheck[];
  relationships: RelationshipForQualityCheck[];
  /** entityType ("Product" | "Service" | "Faq" | "Policy" | "Contact" | "Chunk" | "Category") -> set of currently-valid ids for that type, for broken-reference detection. "Category" has no fixed id set and is never flagged as broken (any category label is valid by definition). */
  knownEntityIds: Record<string, Set<string>>;
  confidenceFloor?: number;
}

const DEFAULT_CONFIDENCE_FLOOR = 0.4;

export function runQualityChecks(input: QualityCheckInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const confidenceFloor = input.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR;
  const chunkIds = new Set(input.chunks.map((c) => c.id));

  if (input.chunks.length === 0) {
    issues.push({ severity: "error", code: "missing_knowledge", message: "The knowledge base has zero chunks — nothing was learned.", entityType: "Chunk", entityId: "" });
  }

  for (const chunk of input.chunks) {
    if (chunk.content.trim().length === 0) {
      issues.push({ severity: "error", code: "empty_chunk", message: "Chunk has no content.", entityType: "Chunk", entityId: chunk.id });
    }

    if (!Number.isFinite(chunk.confidenceScore) || chunk.confidenceScore < 0 || chunk.confidenceScore > 1) {
      issues.push({ severity: "error", code: "invalid_confidence", message: `Confidence score ${chunk.confidenceScore} is outside the valid [0, 1] range.`, entityType: "Chunk", entityId: chunk.id });
    } else if (chunk.confidenceScore < confidenceFloor) {
      issues.push({ severity: "warning", code: "low_confidence", message: `Confidence score ${chunk.confidenceScore.toFixed(2)} is below the floor (${confidenceFloor}).`, entityType: "Chunk", entityId: chunk.id });
    }

    if (!chunk.category) {
      issues.push({ severity: "warning", code: "missing_category", message: "Chunk has no category assigned.", entityType: "Chunk", entityId: chunk.id });
    }

    if (chunk.isDuplicate) {
      if (!chunk.duplicateOfChunkId) {
        issues.push({ severity: "error", code: "broken_duplicate_reference", message: "Chunk is flagged as a duplicate but has no canonical chunk it points to.", entityType: "Chunk", entityId: chunk.id });
      } else if (chunk.duplicateOfChunkId === chunk.id) {
        issues.push({ severity: "error", code: "self_referential_duplicate", message: "Chunk is marked as a duplicate of itself.", entityType: "Chunk", entityId: chunk.id });
      } else if (!chunkIds.has(chunk.duplicateOfChunkId)) {
        issues.push({ severity: "error", code: "broken_reference", message: `Chunk's duplicateOfChunkId ("${chunk.duplicateOfChunkId}") does not point to any existing chunk.`, entityType: "Chunk", entityId: chunk.id });
      }
    }
  }

  for (const rel of input.relationships) {
    if (rel.sourceType !== "Category" && !(input.knownEntityIds[rel.sourceType]?.has(rel.sourceId) ?? false)) {
      issues.push({ severity: "error", code: "broken_relationship", message: `Relationship's source (${rel.sourceType}:${rel.sourceId}) no longer exists.`, entityType: "KnowledgeRelationship", entityId: rel.id });
    }
    if (rel.targetType !== "Category" && !(input.knownEntityIds[rel.targetType]?.has(rel.targetId) ?? false)) {
      issues.push({ severity: "error", code: "broken_relationship", message: `Relationship's target (${rel.targetType}:${rel.targetId}) no longer exists.`, entityType: "KnowledgeRelationship", entityId: rel.id });
    }
  }

  return issues;
}
