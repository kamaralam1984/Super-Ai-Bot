// Incremental Learning Engine — decides what a training run actually needs
// to (re)process, wiring together two already-built-but-previously-
// orphaned pieces: Phase 2's `planIncrementalRecrawl` (which pages are
// new/modified/unchanged/deleted, comparing this crawl job's pages against
// the last completed one) and Phase 3's `autoUpdateEngine.ts` functions
// (`planKnowledgeUpdate`, `findChunksToRemove`) — both fully built and
// tested already, just never called by anything until now.

import { planIncrementalRecrawl, type CurrentPageRecord, type PreviousPageRecord } from "../../scanner/recrawl/changeDetector";
import { planKnowledgeUpdate, findChunksToRemove, type ExistingChunkRef } from "../../knowledge/update/autoUpdateEngine";
import type { IncrementalFilter } from "../../knowledge/knowledgeBuilder.service";

export interface IncrementalTrainingPlan extends Omit<IncrementalFilter, "chunkIdsToRemove"> {
  isIncremental: boolean;
  chunkIdsToRemove: string[];
  summary: {
    newCount: number;
    modifiedCount: number;
    unchangedCount: number;
    deletedCount: number;
  };
}

export interface PlanIncrementalTrainingParams {
  previousPages: PreviousPageRecord[];
  currentPages: CurrentPageRecord[];
  existingChunks: ExistingChunkRef[];
}

/** Returns a full-rebuild plan (`isIncremental: false`, `allowedUrls: undefined`) when there's no prior crawl to diff against — the very first training run for an installation has nothing to be incremental relative to. */
export function planIncrementalTraining(params: PlanIncrementalTrainingParams): IncrementalTrainingPlan {
  if (params.previousPages.length === 0) {
    return {
      isIncremental: false,
      allowedUrls: undefined,
      chunkIdsToRemove: [],
      summary: { newCount: params.currentPages.length, modifiedCount: 0, unchangedCount: 0, deletedCount: 0 },
    };
  }

  const recrawlPlan = planIncrementalRecrawl(params.previousPages, params.currentPages);
  const updatePlan = planKnowledgeUpdate(recrawlPlan);
  const chunkIdsToRemove = findChunksToRemove(params.existingChunks, recrawlPlan.deletedUrls);

  return {
    isIncremental: true,
    allowedUrls: new Set(updatePlan.urlsNeedingProcessing),
    chunkIdsToRemove,
    summary: {
      newCount: recrawlPlan.newUrls.length,
      modifiedCount: recrawlPlan.modifiedUrls.length,
      unchangedCount: recrawlPlan.unchangedUrls.length,
      deletedCount: recrawlPlan.deletedUrls.length,
    },
  };
}
