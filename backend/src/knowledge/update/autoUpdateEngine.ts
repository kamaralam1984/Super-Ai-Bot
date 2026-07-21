import type { RecrawlPlan } from "../../scanner/recrawl/changeDetector";
import { isEmbeddingStale } from "../embed/embeddings";

export interface UpdateActionPlan {
  /** new + modified page URLs — need the full pipeline: clean, categorize, chunk, dedup, embed, score, version, index */
  urlsNeedingProcessing: string[];
  /** deleted page URLs — their chunks should be removed from the vector index and the knowledge base */
  urlsToRemove: string[];
  /** page URLs whose content hash didn't change — skip entirely, this is the point of incremental recrawl */
  urlsUnchanged: string[];
}

/**
 * Turns Phase 2's page-level recrawl plan (scanner/recrawl/changeDetector.ts
 * — which pages are new/modified/unchanged/deleted) into a knowledge-base
 * action plan. Deliberately thin: the actual re-chunking/re-embedding/
 * re-indexing work is each already-built engine's job (chunk/embed/vector);
 * this module's job is only deciding *which* pages trigger that work, so a
 * recrawl where nothing changed costs nothing beyond the crawl itself.
 */
export function planKnowledgeUpdate(recrawlPlan: RecrawlPlan): UpdateActionPlan {
  return {
    urlsNeedingProcessing: [...recrawlPlan.newUrls, ...recrawlPlan.modifiedUrls],
    urlsToRemove: recrawlPlan.deletedUrls,
    urlsUnchanged: recrawlPlan.unchangedUrls,
  };
}

export interface ExistingChunkRef {
  chunkId: string;
  sourceUrl: string;
  section: string | null;
}

/**
 * Matches a freshly re-chunked page's chunk (identified by its source URL
 * and heading section path) against a previously-indexed chunk from the
 * same page+section, so a content change versions the existing chunk (see
 * version/versionManager.ts) instead of spawning an unrelated duplicate
 * every time a page is re-chunked. A practical, documented heuristic —
 * chunk *boundaries* can shift between crawls (a paragraph split
 * differently), so this matches on (sourceUrl, section) rather than trying
 * to track individual chunk identity, mirroring the pipeline's own
 * description: "if a chunk with this pageId+section already existed."
 * Returns null when no matching chunk existed — i.e. this is a genuinely
 * new chunk within an already-known page.
 */
export function matchExistingChunk(existingChunks: ExistingChunkRef[], sourceUrl: string, section: string | null): string | null {
  return existingChunks.find((c) => c.sourceUrl === sourceUrl && c.section === section)?.chunkId ?? null;
}

/** Chunk IDs tied to pages that no longer exist on the site — candidates for removal from the vector index and the knowledge base, since serving content from a page that's gone risks answering from unsupported data. */
export function findChunksToRemove(existingChunks: ExistingChunkRef[], deletedUrls: string[]): string[] {
  const deletedSet = new Set(deletedUrls);
  return existingChunks.filter((c) => deletedSet.has(c.sourceUrl)).map((c) => c.chunkId);
}

export interface EmbeddingMetaRef {
  chunkId: string;
  embeddingModel: string | null;
  embeddingVersion: number | null;
}

/** Chunk IDs whose stored embedding predates the currently active model/version (see embed/embeddings.ts) — need re-embedding and re-indexing even though their content never changed, e.g. after an embedding model upgrade. */
export function findStaleEmbeddings(chunks: EmbeddingMetaRef[]): string[] {
  return chunks.filter((c) => isEmbeddingStale(c.embeddingModel, c.embeddingVersion)).map((c) => c.chunkId);
}

export interface UpdateSummary {
  toProcess: number;
  toRemove: number;
  unchanged: number;
  staleEmbeddings: number;
}

export function summarizeUpdate(plan: UpdateActionPlan, staleEmbeddingChunkIds: string[]): UpdateSummary {
  return {
    toProcess: plan.urlsNeedingProcessing.length,
    toRemove: plan.urlsToRemove.length,
    unchanged: plan.urlsUnchanged.length,
    staleEmbeddings: staleEmbeddingChunkIds.length,
  };
}
