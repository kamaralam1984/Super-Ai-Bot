import { PrismaClient, Prisma, type ChunkType as PrismaChunkType } from "@prisma/client";
import type { HeadingSet, ExtractedTable } from "../scanner/parse/htmlParser";

function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface LoadedPage {
  id: string;
  url: string;
  title: string | null;
  pageType: string | null;
  headings: HeadingSet | null;
  paragraphs: string[] | null;
  lists: { ordered: boolean; items: string[] }[] | null;
  tables: ExtractedTable[] | null;
  ocrResults: { imageUrl: string; text: string; confidence: number; language?: string }[] | null;
  fetchedAt: Date;
}

export interface LoadedDocument {
  id: string;
  sourceUrl: string;
  documentType: string;
  extractedText: string | null;
  errorMessage: string | null;
  tables: string[][][] | null;
  fetchedAt: Date;
}

export interface LoadedFaq {
  id: string;
  pageId: string;
  question: string;
  answer: string;
  source: string;
}

export interface LoadedCrawlData {
  installationId: string;
  pages: LoadedPage[];
  documents: LoadedDocument[];
  faqs: LoadedFaq[];
}

export interface ExistingChunkRecord {
  chunkId: string;
  sourceUrl: string;
  section: string | null;
  content: string;
  embedding: number[];
  embeddingModel: string | null;
  embeddingVersion: number | null;
  confidenceScore: number;
  version: number;
}

export interface ChunkToSave {
  content: string;
  chunkType: PrismaChunkType;
  title: string | null;
  section: string | null;
  category: string | null;
  language: string | null;
  sourceUrl: string;
  confidenceScore: number;
  embedding: number[];
  embeddingModel: string;
  embeddingVersion: number;
  pageId?: string | null;
  documentId?: string | null;
  isDuplicate: boolean;
  duplicateOfChunkId: string | null;
}

/**
 * Phase 3's Prisma persistence layer — mirrors Phase 2's
 * scanRecord.service.ts pattern exactly (one PrismaClient per build run,
 * not per-write; a JSON round-trip cast for every Json-typed column write).
 * Every engine module (chunk/embed/vector/categorize/dedup/version/
 * confidence/...) stays Prisma-free by design; this is the one place their
 * outputs actually get written to or read from the database.
 */
export class KnowledgeRecordService {
  private prisma: PrismaClient;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async loadCrawlData(crawlJobId: string): Promise<LoadedCrawlData> {
    const job = await this.prisma.crawlJob.findUniqueOrThrow({ where: { id: crawlJobId }, select: { installationId: true } });

    const pages = await this.prisma.crawledPage.findMany({
      where: { crawlJobId, crawlStatus: "SUCCESS", isDuplicate: false },
    });
    const documents = await this.prisma.processedDocument.findMany({ where: { crawlJobId, isDuplicate: false } });
    const faqs = await this.prisma.extractedFaq.findMany({ where: { page: { crawlJobId }, isDuplicate: false } });

    return {
      installationId: job.installationId,
      pages: pages.map((p) => ({
        id: p.id,
        url: p.url,
        title: p.title,
        pageType: p.pageType,
        headings: (p.headings as unknown as HeadingSet) ?? null,
        paragraphs: (p.paragraphs as unknown as string[]) ?? null,
        lists: (p.lists as unknown as { ordered: boolean; items: string[] }[]) ?? null,
        tables: (p.tables as unknown as ExtractedTable[]) ?? null,
        ocrResults: (p.ocrResults as unknown as LoadedPage["ocrResults"]) ?? null,
        fetchedAt: p.fetchedAt,
      })),
      documents: documents.map((d) => ({
        id: d.id,
        sourceUrl: d.sourceUrl,
        documentType: d.documentType,
        extractedText: d.extractedText,
        errorMessage: d.errorMessage,
        tables: (d.tables as unknown as string[][][]) ?? null,
        fetchedAt: d.fetchedAt,
      })),
      faqs: faqs.map((f) => ({ id: f.id, pageId: f.pageId, question: f.question, answer: f.answer, source: f.source })),
    };
  }

  /**
   * Every non-duplicate chunk currently live for this installation
   * (across all its past crawl jobs) — used for cross-rebuild chunk
   * matching (update/autoUpdateEngine.ts's matchExistingChunk) and for
   * feeding the search engine's keyword pass / semantic-index rebuilds.
   * A chunk's "current version" isn't a stored column — it's derived as
   * (number of archived ChunkVersion rows) + 1, since every content
   * change archives the prior state before overwriting (see
   * version/versionManager.ts).
   */
  async getExistingChunksForInstallation(installationId: string): Promise<ExistingChunkRecord[]> {
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { crawlJob: { installationId }, isDuplicate: false },
      include: { _count: { select: { versions: true } } },
    });
    return chunks.map((c) => ({
      chunkId: c.id,
      sourceUrl: c.sourceUrl,
      section: c.section,
      content: c.content,
      embedding: c.embedding,
      embeddingModel: c.embeddingModel,
      embeddingVersion: c.embeddingVersion,
      confidenceScore: c.confidenceScore,
      version: c._count.versions + 1,
    }));
  }

  /** Inserts a brand-new chunk (no prior version). Returns its generated id. */
  async createChunk(crawlJobId: string, chunk: ChunkToSave): Promise<string> {
    const created = await this.prisma.knowledgeChunk.create({
      data: {
        crawlJobId,
        pageId: chunk.pageId ?? undefined,
        documentId: chunk.documentId ?? undefined,
        content: chunk.content,
        chunkType: chunk.chunkType,
        title: chunk.title,
        section: chunk.section,
        category: chunk.category,
        language: chunk.language,
        sourceUrl: chunk.sourceUrl,
        confidenceScore: chunk.confidenceScore,
        embedding: chunk.embedding,
        embeddingModel: chunk.embeddingModel,
        embeddingVersion: chunk.embeddingVersion,
        isDuplicate: chunk.isDuplicate,
        duplicateOfChunkId: chunk.duplicateOfChunkId,
      },
    });
    return created.id;
  }

  /**
   * Updates an existing chunk in place with new content (moving it onto
   * the current crawl job), after the caller has already archived its
   * prior state via `archiveVersion` — see version/versionManager.ts's
   * planVersionUpdate, which decides whether this is even necessary.
   */
  async updateChunk(chunkId: string, crawlJobId: string, chunk: ChunkToSave): Promise<void> {
    await this.prisma.knowledgeChunk.update({
      where: { id: chunkId },
      data: {
        crawlJobId,
        pageId: chunk.pageId ?? undefined,
        documentId: chunk.documentId ?? undefined,
        content: chunk.content,
        chunkType: chunk.chunkType,
        title: chunk.title,
        section: chunk.section,
        category: chunk.category,
        language: chunk.language,
        confidenceScore: chunk.confidenceScore,
        embedding: chunk.embedding,
        embeddingModel: chunk.embeddingModel,
        embeddingVersion: chunk.embeddingVersion,
        isDuplicate: chunk.isDuplicate,
        duplicateOfChunkId: chunk.duplicateOfChunkId,
      },
    });
  }

  /**
   * Narrow update for rollback (version/versionManager.ts's planRollback):
   * touches only content/embedding/confidenceScore, leaving crawlJobId,
   * title, category, language, chunkType, and embeddingModel/Version
   * untouched — those aren't part of what a ChunkVersion snapshot
   * captures, so a rollback has no authoritative new value for them and
   * shouldn't overwrite them with stale or blank data.
   */
  async restoreChunkContent(chunkId: string, restored: { content: string; embedding: number[]; confidenceScore: number }): Promise<void> {
    await this.prisma.knowledgeChunk.update({
      where: { id: chunkId },
      data: { content: restored.content, embedding: restored.embedding, confidenceScore: restored.confidenceScore },
    });
  }

  async archiveVersion(chunkId: string, version: { version: number; content: string; embedding: number[]; confidenceScore: number; changeReason: string }): Promise<void> {
    await this.prisma.chunkVersion.create({
      data: {
        chunkId,
        version: version.version,
        content: version.content,
        embedding: version.embedding,
        confidenceScore: version.confidenceScore,
        changeReason: version.changeReason,
      },
    });
  }

  async getChunkVersionHistory(chunkId: string): Promise<{ version: number; content: string; embedding: number[]; confidenceScore: number }[]> {
    const versions = await this.prisma.chunkVersion.findMany({ where: { chunkId }, orderBy: { version: "asc" } });
    return versions.map((v) => ({ version: v.version, content: v.content, embedding: v.embedding, confidenceScore: v.confidenceScore }));
  }

  async getChunkById(chunkId: string): Promise<ExistingChunkRecord | null> {
    const chunk = await this.prisma.knowledgeChunk.findUnique({ where: { id: chunkId }, include: { _count: { select: { versions: true } } } });
    if (!chunk) return null;
    return {
      chunkId: chunk.id,
      sourceUrl: chunk.sourceUrl,
      section: chunk.section,
      content: chunk.content,
      embedding: chunk.embedding,
      embeddingModel: chunk.embeddingModel,
      embeddingVersion: chunk.embeddingVersion,
      confidenceScore: chunk.confidenceScore,
      version: chunk._count.versions + 1,
    };
  }

  async deleteChunks(chunkIds: string[]): Promise<void> {
    if (chunkIds.length === 0) return;
    await this.prisma.knowledgeChunk.deleteMany({ where: { id: { in: chunkIds } } });
  }

  async getCrawlJobInstallationId(crawlJobId: string): Promise<string> {
    const job = await this.prisma.crawlJob.findUniqueOrThrow({ where: { id: crawlJobId }, select: { installationId: true } });
    return job.installationId;
  }

  async getChunkInstallationId(chunkId: string): Promise<string | null> {
    const chunk = await this.prisma.knowledgeChunk.findUnique({ where: { id: chunkId }, select: { crawlJob: { select: { installationId: true } } } });
    return chunk?.crawlJob.installationId ?? null;
  }

  /**
   * Every chunk whose live row is still attributed to this crawl job —
   * i.e. candidates for version/versionManager.ts's
   * planTrainingRunRollback. Deliberately includes duplicate chunks (unlike
   * getExistingChunksForInstallation, which excludes them for matching
   * purposes) — a duplicate chunk this run *created* must also be deleted
   * on rollback, or it would be left behind as an orphaned duplicate
   * pointing nowhere meaningful.
   */
  async getChunksForCrawlJobRollback(crawlJobId: string): Promise<
    { chunkId: string; version: number; content: string; embedding: number[]; confidenceScore: number; archivedDuringRun?: { version: number; content: string; embedding: number[]; confidenceScore: number } }[]
  > {
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { crawlJobId },
      include: { _count: { select: { versions: true } }, versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    return chunks.map((c) => ({
      chunkId: c.id,
      version: c._count.versions + 1,
      content: c.content,
      embedding: c.embedding,
      confidenceScore: c.confidenceScore,
      archivedDuringRun: c.versions[0]
        ? { version: c.versions[0].version, content: c.versions[0].content, embedding: c.versions[0].embedding, confidenceScore: c.versions[0].confidenceScore }
        : undefined,
    }));
  }

  async markFaqDuplicate(faqId: string, duplicateOfFaqId: string): Promise<void> {
    await this.prisma.extractedFaq.update({ where: { id: faqId }, data: { isDuplicate: true, duplicateOfFaqId } });
  }

  async upsertVectorIndexMeta(namespace: string, stats: { vectorCount: number; dimensions: number; indexFilePath: string; embeddingModel: string }): Promise<void> {
    await this.prisma.vectorIndexMeta.upsert({
      where: { namespace },
      create: { namespace, ...stats, lastRebuiltAt: new Date() },
      update: { ...stats, lastRebuiltAt: new Date() },
    });
  }

  async logSearchQuery(entry: {
    installationId: string;
    queryText: string;
    queryLanguage: string | null;
    searchMode: string;
    resultCount: number;
    topChunkIds: string[];
    tookMs: number;
  }): Promise<void> {
    await this.prisma.searchQueryLog.create({
      data: {
        installationId: entry.installationId,
        queryText: entry.queryText,
        queryLanguage: entry.queryLanguage,
        searchMode: entry.searchMode,
        resultCount: entry.resultCount,
        topChunkIds: toJson(entry.topChunkIds),
        tookMs: entry.tookMs,
      },
    });
  }

  /** All non-duplicate chunks for one installation, in the shape searchEngine.ts's keyword pass needs. */
  async getSearchCandidates(installationId: string, filters: { category?: string; language?: string } = {}): Promise<{ chunkId: string; content: string; sourceUrl: string; title: string | null; category: string | null; confidenceScore: number; embedding: number[] }[]> {
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        crawlJob: { installationId },
        isDuplicate: false,
        category: filters.category,
        language: filters.language,
      },
    });
    return chunks.map((c) => ({ chunkId: c.id, content: c.content, sourceUrl: c.sourceUrl, title: c.title, category: c.category, confidenceScore: c.confidenceScore, embedding: c.embedding }));
  }
}
