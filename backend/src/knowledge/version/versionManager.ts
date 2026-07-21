import { contentHash } from "../dedup/chunkDeduplicator";

export interface ChunkSnapshot {
  content: string;
  embedding: number[];
  confidenceScore: number;
}

export interface VersionedChunkState extends ChunkSnapshot {
  version: number;
}

export interface ArchivedVersion {
  version: number;
  content: string;
  embedding: number[];
  confidenceScore: number;
  changeReason: string;
}

export interface VersionUpdateDecision {
  /** false when the incoming content is unchanged (by normalized-content hash) from the current live state — nothing to archive, nothing to write. */
  changed: boolean;
  /** the current live state, to be written to ChunkVersion before the live row is overwritten — present only when changed is true */
  archivedVersion?: ArchivedVersion;
  /** the version number the live row should carry after this update */
  nextVersion: number;
}

/**
 * Decides whether a chunk's content actually changed (recrawl found the
 * source page modified) and, if so, produces the ChunkVersion snapshot of
 * its *current* state that must be archived before the live row is
 * overwritten with the incoming content — matching the pipeline's
 * "Version — if a chunk with this pageId+section already existed, archive
 * its previous content+embedding to ChunkVersion before overwriting" step.
 *
 * Change detection uses the same normalized content hash as duplicate
 * detection (dedup/chunkDeduplicator.ts) — a whitespace/formatting-only
 * difference from a recrawl isn't a real content change and shouldn't
 * spawn a new version.
 */
export function planVersionUpdate(current: VersionedChunkState, incoming: ChunkSnapshot, changeReason = "source content changed on recrawl"): VersionUpdateDecision {
  const changed = contentHash(current.content) !== contentHash(incoming.content);
  if (!changed) {
    return { changed: false, nextVersion: current.version };
  }
  return {
    changed: true,
    archivedVersion: {
      version: current.version,
      content: current.content,
      embedding: current.embedding,
      confidenceScore: current.confidenceScore,
      changeReason,
    },
    nextVersion: current.version + 1,
  };
}

export interface VersionRecord {
  version: number;
  content: string;
  embedding: number[];
  confidenceScore: number;
}

export interface RollbackPlan {
  restoredContent: string;
  restoredEmbedding: number[];
  restoredConfidenceScore: number;
  /** the pre-rollback live state, archived before being overwritten — rollback never destroys history, it adds to it */
  archivedVersion: ArchivedVersion;
  nextVersion: number;
}

/**
 * Plans a rollback to an earlier version. Deliberately forward-only (like
 * `git revert`, not `git reset --hard`): rolling back to version N doesn't
 * delete versions N+1..current, it archives the current live state as a
 * new version and makes version N's content live again — so the full
 * history (including "we rolled back" as an event) stays intact and
 * queryable, consistent with this product's "never silently drop data"
 * approach to duplicates and everything else in the pipeline.
 */
export function planRollback(current: VersionedChunkState, history: VersionRecord[], targetVersion: number): RollbackPlan {
  if (targetVersion === current.version) {
    throw new Error(`Version ${targetVersion} is already the live version — nothing to roll back`);
  }
  const target = history.find((v) => v.version === targetVersion);
  if (!target) {
    throw new Error(`Version ${targetVersion} was not found in this chunk's version history`);
  }

  return {
    restoredContent: target.content,
    restoredEmbedding: target.embedding,
    restoredConfidenceScore: target.confidenceScore,
    archivedVersion: {
      version: current.version,
      content: current.content,
      embedding: current.embedding,
      confidenceScore: current.confidenceScore,
      changeReason: `rolled back to version ${targetVersion}`,
    },
    nextVersion: current.version + 1,
  };
}

export interface TrainingRunChunkState {
  chunkId: string;
  version: number;
  content: string;
  embedding: number[];
  confidenceScore: number;
  /** The ChunkVersion row this chunk's pre-run content was archived to during the run being rolled back — knowledgeBuilder.service.ts only ever calls archiveVersion immediately before updateChunk, in the same operation that moves crawlJobId onto the run, so "this chunk's most recent archived version" and "the version this run itself archived" are the same row whenever the chunk's live crawlJobId still points at this run. Absent means the chunk was newly created by this run (createChunk never archives), so there's no prior content to restore. */
  archivedDuringRun?: VersionRecord;
}

export type TrainingRunRollbackAction =
  | { chunkId: string; kind: "restored"; restoredContent: string; restoredEmbedding: number[]; restoredConfidenceScore: number; archivedVersion: ArchivedVersion; nextVersion: number }
  | { chunkId: string; kind: "deleted" };

export interface TrainingRunRollbackPlan {
  crawlJobId: string;
  actions: TrainingRunRollbackAction[];
  restoredCount: number;
  deletedCount: number;
}

/**
 * Rolls back every chunk one training run (crawl job) touched, in a single
 * operation — extending `planRollback`'s per-chunk logic (reused verbatim
 * for the "restored" case, so both paths share one forward-only-history
 * rule) to run scope. A chunk this run only *updated* is restored to its
 * `archivedDuringRun` snapshot, same as a manual single-chunk rollback. A
 * chunk this run *created* has no prior state to restore to — "this run
 * should never have happened" for it means it shouldn't exist, so it's
 * deleted outright (same reasoning as knowledgeBuilder.service.ts's
 * removeChunks for pages that disappear on recrawl).
 *
 * Deliberately scoped to chunks the caller already filtered down to this
 * run's live crawlJobId — a chunk a *later* run has already touched again
 * is out of scope by construction (its provenance for this run is gone;
 * rolling further back would need multi-run history reconstruction
 * ChunkVersion doesn't carry, since it records no crawlJobId of its own).
 */
export function planTrainingRunRollback(crawlJobId: string, chunkStates: TrainingRunChunkState[]): TrainingRunRollbackPlan {
  const actions: TrainingRunRollbackAction[] = chunkStates.map((state) => {
    if (!state.archivedDuringRun) {
      return { chunkId: state.chunkId, kind: "deleted" };
    }
    const rollback = planRollback(
      { version: state.version, content: state.content, embedding: state.embedding, confidenceScore: state.confidenceScore },
      [state.archivedDuringRun],
      state.archivedDuringRun.version
    );
    return {
      chunkId: state.chunkId,
      kind: "restored",
      restoredContent: rollback.restoredContent,
      restoredEmbedding: rollback.restoredEmbedding,
      restoredConfidenceScore: rollback.restoredConfidenceScore,
      archivedVersion: rollback.archivedVersion,
      nextVersion: rollback.nextVersion,
    };
  });
  return {
    crawlJobId,
    actions,
    restoredCount: actions.filter((a) => a.kind === "restored").length,
    deletedCount: actions.filter((a) => a.kind === "deleted").length,
  };
}
