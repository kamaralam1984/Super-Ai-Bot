// Training-run-level rollback orchestrator — composes the pure plan from
// version/versionManager.ts's planTrainingRunRollback with the two impure
// edges a rollback actually needs to touch: Postgres (via
// KnowledgeRecordService) and the vector index (via vectorStore), mirroring
// exactly how knowledgeBuilder.service.ts composes the same two edges for a
// forward build. Kept out of KnowledgeRecordService itself, matching that
// file's existing convention of staying Prisma-only and leaving
// cross-system composition to a dedicated orchestrator.
//
// Scope note: this rolls back knowledge chunks + the vector index for one
// training run — the two systems a run's own writes actually mutate.
// Config and connector state have no version history to roll back to (they
// aren't touched by a training run at all), so "rollback config/connectors"
// from the original spec is intentionally not implemented here; see
// docs/AUTO_UPDATE_ENGINE.md.

import { KnowledgeRecordService } from "../knowledgeRecord.service";
import { planTrainingRunRollback } from "../version/versionManager";
import { getDefaultVectorStore } from "../vector/vectorStore";
import { EMBEDDING_MODEL } from "../embed/embeddings";
import { recordAuditEvent } from "../security/auditLog";

export interface TrainingRunRollbackReport {
  crawlJobId: string;
  installationId: string;
  chunksRestored: number;
  chunksDeleted: number;
  vectorCount: number;
}

export async function rollbackTrainingRun(databaseUrl: string, crawlJobId: string): Promise<TrainingRunRollbackReport> {
  const records = new KnowledgeRecordService(databaseUrl);
  try {
    const installationId = await records.getCrawlJobInstallationId(crawlJobId);
    const candidates = await records.getChunksForCrawlJobRollback(crawlJobId);
    const plan = planTrainingRunRollback(crawlJobId, candidates);

    const vectorStore = getDefaultVectorStore();
    const restoredVectors: { chunkId: string; vector: number[] }[] = [];
    const deletedIds: string[] = [];

    for (const action of plan.actions) {
      if (action.kind === "restored") {
        await records.archiveVersion(action.chunkId, action.archivedVersion);
        await records.restoreChunkContent(action.chunkId, {
          content: action.restoredContent,
          embedding: action.restoredEmbedding,
          confidenceScore: action.restoredConfidenceScore,
        });
        restoredVectors.push({ chunkId: action.chunkId, vector: action.restoredEmbedding });
      } else {
        deletedIds.push(action.chunkId);
      }
    }

    if (deletedIds.length > 0) {
      await records.deleteChunks(deletedIds);
      for (const id of deletedIds) vectorStore.remove(installationId, id);
    }
    if (restoredVectors.length > 0) {
      vectorStore.upsertMany(installationId, restoredVectors);
    }

    const stats = vectorStore.stats(installationId);
    if (stats) {
      await records.upsertVectorIndexMeta(installationId, {
        vectorCount: stats.vectorCount,
        dimensions: stats.dimensions,
        indexFilePath: `storage/vector-index/${installationId}.hnsw`,
        embeddingModel: EMBEDDING_MODEL,
      });
    }

    recordAuditEvent({
      type: "rollback_performed",
      detail: `crawlJob=${crawlJobId} chunksRestored=${plan.restoredCount} chunksDeleted=${plan.deletedCount}`,
    });

    return { crawlJobId, installationId, chunksRestored: plan.restoredCount, chunksDeleted: plan.deletedCount, vectorCount: stats?.vectorCount ?? 0 };
  } finally {
    await records.close();
  }
}
