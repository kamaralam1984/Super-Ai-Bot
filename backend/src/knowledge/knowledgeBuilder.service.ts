import type { ChunkType as PrismaChunkType } from "@prisma/client";
import { KnowledgeRecordService, type ChunkToSave, type LoadedDocument, type LoadedPage } from "./knowledgeRecord.service";
import { chunkBlocks, type SemanticBlock, type KnowledgeChunkDraft } from "./chunk/chunker";
import { parseTextIntoBlocks } from "./chunk/markdownStructureParser";
import { embedTexts, EMBEDDING_MODEL, EMBEDDING_VERSION } from "./embed/embeddings";
import { getDefaultVectorStore } from "./vector/vectorStore";
import { categorizeChunk, type KnowledgeCategory } from "./categorize/categoryClassifier";
import { detectChunkLanguage } from "./language/multiLanguage";
import { deduplicate, deduplicateFaqs } from "./dedup/chunkDeduplicator";
import { scoreConfidence } from "./confidence/confidenceScorer";
import { planVersionUpdate } from "./version/versionManager";
import { matchExistingChunk, type ExistingChunkRef } from "./update/autoUpdateEngine";
import { formatError } from "../utils/formatError";

export interface KnowledgeBuildProgressEvent {
  step: string;
  message: string;
  percent: number;
}

export interface KnowledgeBuildResult {
  success: boolean;
  crawlJobId: string;
  chunksCreated: number;
  chunksUpdated: number;
  chunksUnchanged: number;
  duplicatesFound: number;
  chunksRemoved?: number;
  vectorCount: number;
  errorMessage?: string;
}

/**
 * Phase 6's incremental-training hook — optional and additive, so every
 * existing caller (Phase 3's own route/tests) that omits this parameter
 * gets byte-for-byte the same full-rebuild behavior as before.
 *
 * `allowedUrls`, when set, restricts which content units get
 * (re-)chunked/embedded/scored to just those URLs — everything else
 * (matching against existing chunks, versioning) still considers the
 * *whole* installation's existing knowledge base, since a piece of
 * unchanged content can still need to be matched against for correct
 * version-vs-create decisions. `chunkIdsToRemove` are chunks belonging to
 * pages that were deleted since the last build — removed from both
 * Postgres and the vector index. When `allowedUrls` is set, the vector
 * index step does a targeted `upsertMany`/`remove` instead of a full
 * `rebuild()`, which is what actually makes this "incremental" rather
 * than "process less, then throw all the work away rebuilding everything
 * anyway."
 */
export interface IncrementalFilter {
  allowedUrls?: Set<string>;
  chunkIdsToRemove?: string[];
}

function buildPageBlocks(page: LoadedPage): SemanticBlock[] {
  const blocks: SemanticBlock[] = [];
  for (const paragraph of page.paragraphs ?? []) blocks.push({ kind: "paragraph", text: paragraph });
  for (const list of page.lists ?? []) blocks.push({ kind: "list", items: list.items });
  for (const table of page.tables ?? []) blocks.push({ kind: "table", rows: [table.headers, ...table.rows] });
  return blocks;
}

/**
 * Documents' extracted `tables[]` are structured cleanly by
 * documentExtractor.ts, but only XLSX/CSV's flattened `extractedText` is
 * *entirely redundant* with them (it's the same cells joined as
 * "cell | cell" lines) — so for those two types, the table blocks replace
 * the flat-text blocks rather than duplicating the same content twice.
 * DOCX's flattened text also happens to contain table cells inline
 * (mammoth's plain-text conversion doesn't separate them from surrounding
 * paragraphs), so a DOCX table's cells can end up covered by both a prose
 * chunk and a clean TABLE chunk — a known, documented redundancy, not a
 * correctness bug: both chunks carry accurate (if overlapping)
 * information, and fixing it would require parsing DOCX layout more
 * precisely than mammoth's HTML conversion + cheerio provides.
 */
function buildDocumentBlocks(doc: LoadedDocument): SemanticBlock[] {
  if (doc.documentType === "XLSX" || doc.documentType === "CSV") {
    return (doc.tables ?? []).map((rows) => ({ kind: "table" as const, rows }));
  }
  const textBlocks = doc.extractedText ? parseTextIntoBlocks(doc.extractedText) : [];
  const tableBlocks = (doc.tables ?? []).map((rows) => ({ kind: "table" as const, rows }));
  return [...textBlocks, ...tableBlocks];
}

interface ContentUnit {
  sourceUrl: string;
  title: string | null;
  section: string | null;
  blocks: SemanticBlock[];
  pageId?: string;
  documentId?: string;
  pageType?: string | null;
  extractionSource?: "structured_data" | "heuristic" | null;
  extractionErrorMessage?: string | null;
  fetchedAt: Date;
  ocrConfidence?: number | null;
}

interface EnrichedChunk {
  content: string;
  chunkType: PrismaChunkType;
  title: string | null;
  section: string | null;
  sourceUrl: string;
  category: KnowledgeCategory;
  language: string;
  pageId: string | null;
  documentId: string | null;
  extractionSource: "structured_data" | "heuristic" | null;
  extractionErrorMessage: string | null;
  fetchedAt: Date;
  ocrConfidence: number | null;
}

function documentTitle(sourceUrl: string): string {
  const lastSegment = sourceUrl.split("/").filter(Boolean).pop();
  return lastSegment ?? sourceUrl;
}

/** Deletes chunks belonging to removed pages from both Postgres and the vector index, and refreshes VectorIndexMeta. No-op (returns the index's current count unchanged) when there's nothing to remove. */
async function removeChunks(records: KnowledgeRecordService, installationId: string, chunkIdsToRemove: string[] | undefined): Promise<{ count: number; vectorCount: number }> {
  const vectorStore = getDefaultVectorStore();
  if (chunkIdsToRemove && chunkIdsToRemove.length > 0) {
    await records.deleteChunks(chunkIdsToRemove);
    for (const id of chunkIdsToRemove) vectorStore.remove(installationId, id);
  }
  const stats = vectorStore.stats(installationId);
  if (stats) {
    await records.upsertVectorIndexMeta(installationId, { vectorCount: stats.vectorCount, dimensions: stats.dimensions, indexFilePath: `storage/vector-index/${installationId}.hnsw`, embeddingModel: EMBEDDING_MODEL });
  }
  return { count: chunkIdsToRemove?.length ?? 0, vectorCount: stats?.vectorCount ?? 0 };
}

/**
 * Top-level Phase 3 orchestrator: reads one crawl job's raw Phase 2 output
 * (pages, documents, FAQs) and builds/updates the AI-ready knowledge base
 * for that installation — clean/structure -> chunk -> categorize ->
 * detect language -> deduplicate -> embed -> score confidence -> version
 * (archiving changed chunks, matching new content against what already
 * exists for this installation) -> rebuild the vector index. Deliberately
 * a separate, re-runnable stage from the crawl itself (see
 * docs/KNOWLEDGE_BUILDER.md) — every engine it calls is already
 * independently tested; this wires them together and is the only place
 * that touches Prisma writes (via KnowledgeRecordService).
 */
export async function runKnowledgeBuild(databaseUrl: string, crawlJobId: string, onProgress: (event: KnowledgeBuildProgressEvent) => void, incremental?: IncrementalFilter): Promise<KnowledgeBuildResult> {
  const records = new KnowledgeRecordService(databaseUrl);
  try {
    onProgress({ step: "load", message: "Loading crawl data", percent: 5 });
    const data = await records.loadCrawlData(crawlJobId);
    const allowedUrls = incremental?.allowedUrls;

    const units: ContentUnit[] = [];
    for (const page of data.pages) {
      if (allowedUrls && !allowedUrls.has(page.url)) continue;
      const blocks = buildPageBlocks(page);
      if (blocks.length > 0) {
        units.push({ sourceUrl: page.url, title: page.title, section: page.title, blocks, pageId: page.id, fetchedAt: page.fetchedAt, pageType: page.pageType });
      }
      for (const ocr of page.ocrResults ?? []) {
        if (!ocr.text.trim()) continue;
        units.push({
          sourceUrl: page.url,
          title: page.title,
          section: page.title,
          blocks: [{ kind: "paragraph", text: ocr.text }],
          pageId: page.id,
          fetchedAt: page.fetchedAt,
          pageType: page.pageType,
          ocrConfidence: ocr.confidence,
        });
      }
    }
    for (const doc of data.documents) {
      if (allowedUrls && !allowedUrls.has(doc.sourceUrl)) continue;
      const blocks = buildDocumentBlocks(doc);
      if (blocks.length > 0) {
        units.push({
          sourceUrl: doc.sourceUrl,
          title: documentTitle(doc.sourceUrl),
          section: null,
          blocks,
          documentId: doc.id,
          fetchedAt: doc.fetchedAt,
          extractionErrorMessage: doc.errorMessage,
        });
      }
    }

    onProgress({ step: "chunk", message: `Chunking ${units.length} content units`, percent: 15 });
    const drafts: { draft: KnowledgeChunkDraft; unit: ContentUnit }[] = [];
    for (const unit of units) {
      for (const draft of chunkBlocks(unit.blocks)) {
        drafts.push({ draft: { ...draft, title: draft.title ?? unit.title, section: draft.section ?? unit.section }, unit });
      }
    }

    onProgress({ step: "faqs", message: "Deduplicating FAQs", percent: 20 });
    // deduplicateFaqs' near-duplicate pass only runs over items that carry
    // an `embedding` — omitting it (as this call used to) doesn't error,
    // it just silently skips semantic-similarity matching entirely and
    // falls back to exact-content-hash matching only, so two FAQs that ask
    // the same thing in different words were never caught. Found via a
    // real end-to-end run with genuinely near-duplicate (not
    // byte-identical) FAQ pairs — see docs/AI_TRAINING_ENGINE.md's
    // "What real-world testing caught".
    const faqEmbeddings = data.faqs.length > 0 ? await embedTexts(data.faqs.map((f) => `${f.question}\n${f.answer}`)) : [];
    const faqDedup = deduplicateFaqs(data.faqs.map((f, i) => ({ id: f.id, question: f.question, answer: f.answer, embedding: faqEmbeddings[i] })));
    await Promise.all(
      data.faqs
        .filter((f) => faqDedup.canonicalOf.get(f.id) !== f.id)
        .map((f) => records.markFaqDuplicate(f.id, faqDedup.canonicalOf.get(f.id)!))
    );
    const pageById = new Map(data.pages.map((p) => [p.id, p]));
    for (const faq of data.faqs.filter((f) => faqDedup.canonicalOf.get(f.id) === f.id)) {
      const page = pageById.get(faq.pageId);
      drafts.push({
        draft: { content: `Q: ${faq.question}\nA: ${faq.answer}`, index: 0, chunkType: "PARAGRAPH", title: faq.question, section: page?.title ?? null },
        unit: {
          sourceUrl: page?.url ?? "",
          title: page?.title ?? null,
          section: page?.title ?? null,
          blocks: [],
          pageId: faq.pageId,
          fetchedAt: page?.fetchedAt ?? new Date(),
          pageType: page?.pageType,
          extractionSource: faq.source === "structured_data" ? "structured_data" : "heuristic",
        },
      });
    }

    onProgress({ step: "categorize", message: "Categorizing and detecting language", percent: 30 });
    const enriched: EnrichedChunk[] = drafts.map(({ draft, unit }) => {
      const category = categorizeChunk({ content: draft.content, title: draft.title, section: draft.section, sourceUrl: unit.sourceUrl, pageType: unit.pageType }).category;
      const language = detectChunkLanguage(draft.content).name;
      return {
        content: draft.content,
        chunkType: draft.chunkType,
        title: draft.title,
        section: draft.section,
        sourceUrl: unit.sourceUrl,
        category,
        language,
        pageId: unit.pageId ?? null,
        documentId: unit.documentId ?? null,
        extractionSource: unit.extractionSource ?? null,
        extractionErrorMessage: unit.extractionErrorMessage ?? null,
        fetchedAt: unit.fetchedAt,
        ocrConfidence: unit.ocrConfidence ?? null,
      };
    });

    if (enriched.length === 0) {
      // Even with nothing new to process, an incremental run may still have
      // deletions to apply (a page was removed since the last crawl).
      const removed = await removeChunks(records, data.installationId, incremental?.chunkIdsToRemove);
      onProgress({ step: "done", message: "No content to build a knowledge base from", percent: 100 });
      return { success: true, crawlJobId, chunksCreated: 0, chunksUpdated: 0, chunksUnchanged: 0, duplicatesFound: 0, chunksRemoved: removed.count, vectorCount: removed.vectorCount };
    }

    onProgress({ step: "embed", message: `Embedding ${enriched.length} chunks`, percent: 50 });
    const vectors = await embedTexts(
      enriched.map((e) => e.content),
      { onProgress: (done, total) => onProgress({ step: "embed", message: `Embedded ${done}/${total}`, percent: 50 + Math.round((done / total) * 20) }) }
    );

    onProgress({ step: "dedup", message: "Finding duplicates", percent: 72 });
    const dedupResult = deduplicate(enriched.map((e, i) => ({ id: String(i), content: e.content, embedding: vectors[i] })));
    const clusterSizeOf = new Map<string, number>();
    for (const [canonicalId, members] of dedupResult.clusters) clusterSizeOf.set(canonicalId, members.length);

    onProgress({ step: "score", message: "Scoring confidence", percent: 78 });
    const existingChunks = await records.getExistingChunksForInstallation(data.installationId);
    const existingRefs: ExistingChunkRef[] = existingChunks.map((c) => ({ chunkId: c.chunkId, sourceUrl: c.sourceUrl, section: c.section }));

    onProgress({ step: "persist", message: "Persisting chunks", percent: 85 });
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let duplicatesFound = 0;
    const canonicalDbId = new Map<string, string>();
    // HTML pages don't carry true per-chunk section nesting (see
    // buildPageBlocks' docstring — every chunk from one page shares that
    // page's title as its "section"), so more than one new chunk can
    // legitimately match the same existing chunk by (sourceUrl, section).
    // Each existing chunk may only be claimed by ONE new chunk per build
    // run — otherwise two updates would both try to archive the same
    // existing chunk at the same version number and collide on
    // ChunkVersion's (chunkId, version) unique constraint (a real bug
    // caught running this against a real multi-crawl-job installation).
    // Any new chunk left unmatched after its page's first chunk claims the
    // slot is simply created fresh instead of versioned in place.
    const claimedExistingIds = new Set<string>();
    // Chunks actually created/updated this run — the targeted set an
    // incremental index update needs (see the "index" step below); unlike
    // the full-rebuild path, "unchanged" chunks are deliberately excluded
    // since their vector is already correctly present in the index from
    // whichever earlier run created it.
    const touchedChunks: { chunkId: string; vector: number[] }[] = [];

    const indices = enriched.map((_, i) => String(i));
    const canonicalIndices = indices.filter((i) => dedupResult.canonicalOf.get(i) === i);
    const duplicateIndices = indices.filter((i) => dedupResult.canonicalOf.get(i) !== i);

    for (const i of canonicalIndices) {
      const e = enriched[Number(i)];
      const confidence = scoreConfidence({
        content: e.content,
        extractionSource: e.extractionSource,
        fetchedAt: e.fetchedAt,
        category: e.category,
        extractionErrorMessage: e.extractionErrorMessage,
        duplicateClusterSize: clusterSizeOf.get(i) ?? 1,
        ocrConfidence: e.ocrConfidence,
      }).overallScore;

      const chunkData: ChunkToSave = {
        content: e.content,
        chunkType: e.chunkType,
        title: e.title,
        section: e.section,
        category: e.category,
        language: e.language,
        sourceUrl: e.sourceUrl,
        confidenceScore: confidence,
        embedding: vectors[Number(i)],
        embeddingModel: EMBEDDING_MODEL,
        embeddingVersion: EMBEDDING_VERSION,
        pageId: e.pageId,
        documentId: e.documentId,
        isDuplicate: false,
        duplicateOfChunkId: null,
      };

      const availableRefs = existingRefs.filter((r) => !claimedExistingIds.has(r.chunkId));
      const existingMatchId = matchExistingChunk(availableRefs, e.sourceUrl, e.section);
      if (existingMatchId) {
        claimedExistingIds.add(existingMatchId);
        const existing = existingChunks.find((c) => c.chunkId === existingMatchId)!;
        const decision = planVersionUpdate(
          { version: existing.version, content: existing.content, embedding: existing.embedding, confidenceScore: existing.confidenceScore },
          { content: e.content, embedding: vectors[Number(i)], confidenceScore: confidence }
        );
        if (decision.changed) {
          await records.archiveVersion(existingMatchId, decision.archivedVersion!);
          await records.updateChunk(existingMatchId, crawlJobId, chunkData);
          touchedChunks.push({ chunkId: existingMatchId, vector: vectors[Number(i)] });
          updated++;
        } else {
          unchanged++;
        }
        canonicalDbId.set(i, existingMatchId);
      } else {
        const newId = await records.createChunk(crawlJobId, chunkData);
        touchedChunks.push({ chunkId: newId, vector: vectors[Number(i)] });
        canonicalDbId.set(i, newId);
        created++;
      }
    }

    for (const i of duplicateIndices) {
      const e = enriched[Number(i)];
      const canonicalIndex = dedupResult.canonicalOf.get(i)!;
      const confidence = scoreConfidence({
        content: e.content,
        extractionSource: e.extractionSource,
        fetchedAt: e.fetchedAt,
        category: e.category,
        extractionErrorMessage: e.extractionErrorMessage,
        duplicateClusterSize: clusterSizeOf.get(canonicalIndex) ?? 1,
        ocrConfidence: e.ocrConfidence,
      }).overallScore;

      const duplicateId = await records.createChunk(crawlJobId, {
        content: e.content,
        chunkType: e.chunkType,
        title: e.title,
        section: e.section,
        category: e.category,
        language: e.language,
        sourceUrl: e.sourceUrl,
        confidenceScore: confidence,
        embedding: vectors[Number(i)],
        embeddingModel: EMBEDDING_MODEL,
        embeddingVersion: EMBEDDING_VERSION,
        pageId: e.pageId,
        documentId: e.documentId,
        isDuplicate: true,
        duplicateOfChunkId: canonicalDbId.get(canonicalIndex) ?? null,
      });
      touchedChunks.push({ chunkId: duplicateId, vector: vectors[Number(i)] });
      duplicatesFound++;
    }

    let removedCount = 0;
    const vectorStore = getDefaultVectorStore();
    if (allowedUrls) {
      // Incremental path: apply just the deletions + touched-chunk upserts
      // rather than throwing away and rebuilding the whole installation's
      // index — this is the actual "incremental" part of incremental
      // learning; everything above this point already ran, rebuild or not.
      onProgress({ step: "index", message: "Updating vector index incrementally", percent: 92 });
      if (incremental?.chunkIdsToRemove && incremental.chunkIdsToRemove.length > 0) {
        await records.deleteChunks(incremental.chunkIdsToRemove);
        for (const id of incremental.chunkIdsToRemove) vectorStore.remove(data.installationId, id);
        removedCount = incremental.chunkIdsToRemove.length;
      }
      if (touchedChunks.length > 0) {
        vectorStore.upsertMany(data.installationId, touchedChunks);
      }
    } else {
      onProgress({ step: "index", message: "Rebuilding vector index", percent: 92 });
      const allLiveChunks = await records.getExistingChunksForInstallation(data.installationId);
      vectorStore.rebuild(
        data.installationId,
        allLiveChunks.map((c) => ({ chunkId: c.chunkId, vector: c.embedding }))
      );
    }

    const stats = vectorStore.stats(data.installationId);
    if (stats) {
      await records.upsertVectorIndexMeta(data.installationId, {
        vectorCount: stats.vectorCount,
        dimensions: stats.dimensions,
        indexFilePath: `storage/vector-index/${data.installationId}.hnsw`,
        embeddingModel: EMBEDDING_MODEL,
      });
    }

    onProgress({ step: "done", message: "Knowledge build complete", percent: 100 });
    return { success: true, crawlJobId, chunksCreated: created, chunksUpdated: updated, chunksUnchanged: unchanged, duplicatesFound, chunksRemoved: removedCount, vectorCount: stats?.vectorCount ?? 0 };
  } catch (err) {
    const message = formatError(err);
    onProgress({ step: "error", message, percent: 100 });
    return { success: false, crawlJobId, chunksCreated: 0, chunksUpdated: 0, chunksUnchanged: 0, duplicatesFound: 0, vectorCount: 0, errorMessage: message };
  } finally {
    await records.close();
  }
}
