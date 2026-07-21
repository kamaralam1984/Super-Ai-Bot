import { PrismaClient, Prisma } from "@prisma/client";
import type { CurrentPageRecord, PreviousPageRecord } from "../scanner/recrawl/changeDetector";
import type { ExistingChunkRef } from "../knowledge/update/autoUpdateEngine";
import type { ExtractedContactDraft, ExtractedPolicyDraft, KnowledgeRelationshipDraft, RelatedEntityRef, TrainingReportData } from "./types";

function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function readJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export interface TrainingPageRecord {
  id: string;
  url: string;
  title: string | null;
  pageType: string | null;
  contactInfo: unknown;
}

export interface ProductRecord {
  id: string;
  pageId: string;
  name: string;
  category: string | null;
  description: string | null;
  stockStatus: string | null;
}

export interface ServiceRecord {
  id: string;
  pageId: string;
  name: string;
  description: string | null;
  workflow: unknown;
  industries: string[];
}

export interface FaqDbRecord {
  id: string;
  pageId: string;
  question: string;
  answer: string;
  source: string;
  isDuplicate: boolean;
  duplicateOfFaqId: string | null;
}

export interface ChunkForRelationships {
  id: string;
  pageId: string | null;
  title: string | null;
  content: string;
}

export interface KnowledgeRelationshipRecord extends KnowledgeRelationshipDraft {
  id: string;
  createdAt: Date;
}

/** Phase 6's Prisma persistence layer — same one-service-per-phase pattern as every prior phase's record service. Reads directly from Phase 2/3's tables (CrawlJob, CrawledPage, KnowledgeChunk, ExtractedProduct/Service/Faq) in addition to owning full CRUD on Phase 6's own new tables. */
export class TrainingRecordService {
  private prisma: PrismaClient;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // ── Incremental planning reads ──────────────────────────────────────

  async getCrawlJobMeta(crawlJobId: string): Promise<{ installationId: string; websiteUrl: string }> {
    const job = await this.prisma.crawlJob.findUniqueOrThrow({ where: { id: crawlJobId }, select: { installationId: true, websiteUrl: true } });
    return job;
  }

  async getCurrentPages(crawlJobId: string): Promise<CurrentPageRecord[]> {
    const pages = await this.prisma.crawledPage.findMany({ where: { crawlJobId }, select: { url: true, contentHash: true } });
    return pages.filter((p) => p.contentHash !== null).map((p) => ({ url: p.url, contentHash: p.contentHash as string }));
  }

  async getPreviousCompletedCrawlJobPages(installationId: string, websiteUrl: string, excludeCrawlJobId: string): Promise<PreviousPageRecord[]> {
    const previousJob = await this.prisma.crawlJob.findFirst({
      where: { installationId, websiteUrl, status: "COMPLETED", id: { not: excludeCrawlJobId } },
      orderBy: { startedAt: "desc" },
    });
    if (!previousJob) return [];
    const pages = await this.prisma.crawledPage.findMany({ where: { crawlJobId: previousJob.id }, select: { url: true, contentHash: true } });
    return pages.map((p) => ({ url: p.url, contentHash: p.contentHash }));
  }

  async getExistingChunkRefs(installationId: string): Promise<ExistingChunkRef[]> {
    const chunks = await this.prisma.knowledgeChunk.findMany({ where: { crawlJob: { installationId } }, select: { id: true, sourceUrl: true, section: true } });
    return chunks.map((c) => ({ chunkId: c.id, sourceUrl: c.sourceUrl, section: c.section }));
  }

  // ── Enrichment-engine reads ─────────────────────────────────────────

  async getDocumentCount(crawlJobId: string): Promise<number> {
    return this.prisma.processedDocument.count({ where: { crawlJobId } });
  }

  async getPagesForCrawlJob(crawlJobId: string): Promise<TrainingPageRecord[]> {
    const pages = await this.prisma.crawledPage.findMany({ where: { crawlJobId }, select: { id: true, url: true, title: true, pageType: true, contactInfo: true } });
    return pages;
  }

  async getProductsForInstallation(installationId: string): Promise<ProductRecord[]> {
    const rows = await this.prisma.extractedProduct.findMany({
      where: { page: { crawlJob: { installationId } } },
      select: { id: true, pageId: true, name: true, category: true, description: true, stockStatus: true },
    });
    return rows;
  }

  async getServicesForInstallation(installationId: string): Promise<ServiceRecord[]> {
    const rows = await this.prisma.extractedService.findMany({
      where: { page: { crawlJob: { installationId } } },
      select: { id: true, pageId: true, name: true, description: true, workflow: true, industries: true },
    });
    return rows.map((r) => ({ ...r, industries: readJsonArray<string>(r.industries) }));
  }

  async getFaqsForInstallation(installationId: string): Promise<FaqDbRecord[]> {
    const rows = await this.prisma.extractedFaq.findMany({
      where: { page: { crawlJob: { installationId } } },
      select: { id: true, pageId: true, question: true, answer: true, source: true, isDuplicate: true, duplicateOfFaqId: true },
    });
    return rows;
  }

  /** `policyType` is included (additive to what the pure relationship/report modules consume — they pick only the fields they need) so permission/integration/authorizedTrainingRecordService.ts can filter policies against the Shipping vs. Support Articles scope split without a second query. */
  async getPoliciesForInstallation(installationId: string): Promise<Array<{ id: string; pageId: string; title: string | null; content: string; policyType: string }>> {
    const rows = await this.prisma.extractedPolicy.findMany({ where: { page: { crawlJob: { installationId } } }, select: { id: true, pageId: true, title: true, content: true, policyType: true } });
    return rows;
  }

  async getContactsForInstallation(installationId: string): Promise<Array<{ id: string; pageId: string }>> {
    const rows = await this.prisma.extractedContact.findMany({ where: { page: { crawlJob: { installationId } } }, select: { id: true, pageId: true } });
    return rows;
  }

  /** Raw pre-chunking page text (paragraphs + list items + table cells joined), for the "Validate Knowledge" stage — deliberately reads directly rather than reusing Phase 3's KnowledgeRecordService.loadCrawlData, since validation needs to run *before* Phase 3's own pipeline and only needs plain text, not the full LoadedPage shape. */
  async getContentUnitsForValidation(crawlJobId: string): Promise<Array<{ sourceUrl: string; content: string }>> {
    const pages = await this.prisma.crawledPage.findMany({ where: { crawlJobId }, select: { url: true, paragraphs: true, lists: true, tables: true } });
    return pages.map((p) => {
      const paragraphs = readJsonArray<string>(p.paragraphs);
      const lists = readJsonArray<{ items: string[] }>(p.lists).flatMap((l) => l.items);
      const tables = readJsonArray<{ headers: string[]; rows: string[][] }>(p.tables).flatMap((t) => [t.headers.join(" "), ...t.rows.map((r) => r.join(" "))]);
      return { sourceUrl: p.url, content: [...paragraphs, ...lists, ...tables].join("\n") };
    });
  }

  async getChunksByCategory(installationId: string, category: string): Promise<ChunkForRelationships[]> {
    const rows = await this.prisma.knowledgeChunk.findMany({
      where: { crawlJob: { installationId }, category, isDuplicate: false },
      select: { id: true, pageId: true, title: true, content: true },
    });
    return rows;
  }

  async getAllLiveChunksForQualityCheck(installationId: string): Promise<Array<{ id: string; content: string; category: string | null; confidenceScore: number; isDuplicate: boolean; duplicateOfChunkId: string | null }>> {
    return this.prisma.knowledgeChunk.findMany({
      where: { crawlJob: { installationId } },
      select: { id: true, content: true, category: true, confidenceScore: true, isDuplicate: true, duplicateOfChunkId: true },
    });
  }

  // ── Writes ───────────────────────────────────────────────────────────

  async saveContacts(pageId: string, drafts: ExtractedContactDraft[]): Promise<string[]> {
    const ids: string[] = [];
    for (const draft of drafts) {
      const row = await this.prisma.extractedContact.create({
        data: {
          pageId,
          contactType: draft.contactType,
          branch: draft.branch,
          department: draft.department,
          phones: toJson(draft.phones),
          emails: toJson(draft.emails),
          addresses: toJson(draft.addresses),
          mapsLinks: toJson(draft.mapsLinks),
          hours: toJson(draft.hours),
          source: draft.source,
        },
      });
      ids.push(row.id);
    }
    return ids;
  }

  async savePolicies(pageId: string, drafts: ExtractedPolicyDraft[]): Promise<string[]> {
    const ids: string[] = [];
    for (const draft of drafts) {
      const row = await this.prisma.extractedPolicy.create({
        data: { pageId, policyType: draft.policyType, title: draft.title, content: draft.content, confidenceScore: draft.confidenceScore, source: draft.source },
      });
      ids.push(row.id);
    }
    return ids;
  }

  async updateProductEnrichment(productId: string, data: { benefits: string[] | null; availability: string; relatedProducts: RelatedEntityRef[] }): Promise<void> {
    await this.prisma.extractedProduct.update({
      where: { id: productId },
      data: { benefits: data.benefits ? toJson(data.benefits) : Prisma.JsonNull, availability: data.availability, relatedProducts: toJson(data.relatedProducts) },
    });
  }

  async updateServiceEnrichment(serviceId: string, data: { relatedServices: RelatedEntityRef[]; dependencies: string[] | null }): Promise<void> {
    await this.prisma.extractedService.update({
      where: { id: serviceId },
      data: { relatedServices: toJson(data.relatedServices), dependencies: data.dependencies ? toJson(data.dependencies) : Prisma.JsonNull },
    });
  }

  async updateFaqEnrichment(faqId: string, data: { confidence: number; similarQuestions: RelatedEntityRef[]; relatedQuestions: RelatedEntityRef[]; mergedFaqIds: string[] | null }): Promise<void> {
    await this.prisma.extractedFaq.update({
      where: { id: faqId },
      data: {
        confidence: data.confidence,
        similarQuestions: toJson(data.similarQuestions),
        relatedQuestions: toJson(data.relatedQuestions),
        mergedFaqIds: data.mergedFaqIds ? toJson(data.mergedFaqIds) : Prisma.JsonNull,
      },
    });
  }

  async applyFaqMerge(canonicalId: string, mergedFaqId: string): Promise<void> {
    await this.prisma.extractedFaq.update({ where: { id: mergedFaqId }, data: { isDuplicate: true, duplicateOfFaqId: canonicalId } });
  }

  /** Clears a FAQ's own isDuplicate/duplicateOfFaqId — needed when planFaqMerges picks a different canonical than Phase 3's own initial dedup pass did, since that FAQ may itself still carry a stale `isDuplicate: true` from being a non-canonical member of Phase 3's original clustering. Without this, the "real" canonical can end up permanently (and incorrectly) excluded as a duplicate of a lower-quality member. */
  async setFaqCanonical(faqId: string): Promise<void> {
    await this.prisma.extractedFaq.update({ where: { id: faqId }, data: { isDuplicate: false, duplicateOfFaqId: null } });
  }

  /** Upserts every relationship edge (idempotent on the (sourceType,sourceId,targetType,targetId,relationshipType) unique constraint, so re-running training doesn't duplicate edges — it refreshes confidence/evidence in place). Returns the number of edges written. */
  async saveRelationships(installationId: string, drafts: KnowledgeRelationshipDraft[]): Promise<number> {
    for (const draft of drafts) {
      await this.prisma.knowledgeRelationship.upsert({
        where: { sourceType_sourceId_targetType_targetId_relationshipType: { sourceType: draft.sourceType, sourceId: draft.sourceId, targetType: draft.targetType, targetId: draft.targetId, relationshipType: draft.relationshipType } },
        create: { installationId, sourceType: draft.sourceType, sourceId: draft.sourceId, targetType: draft.targetType, targetId: draft.targetId, relationshipType: draft.relationshipType, confidence: draft.confidence, evidence: toJson(draft.evidence) },
        update: { confidence: draft.confidence, evidence: toJson(draft.evidence) },
      });
    }
    return drafts.length;
  }

  async getRelationshipsForInstallation(installationId: string): Promise<KnowledgeRelationshipRecord[]> {
    const rows = await this.prisma.knowledgeRelationship.findMany({ where: { installationId } });
    return rows.map((r) => ({
      id: r.id,
      sourceType: r.sourceType as KnowledgeRelationshipDraft["sourceType"],
      sourceId: r.sourceId,
      targetType: r.targetType as KnowledgeRelationshipDraft["targetType"],
      targetId: r.targetId,
      relationshipType: r.relationshipType,
      confidence: r.confidence,
      evidence: readJsonArray<string>(r.evidence),
      createdAt: r.createdAt,
    }));
  }

  async saveTrainingReport(report: TrainingReportData): Promise<void> {
    const data = {
      incremental: report.incremental,
      totalDocuments: report.totalDocuments,
      totalPages: report.totalPages,
      productsLearned: report.productsLearned,
      servicesLearned: report.servicesLearned,
      faqsLearned: report.faqsLearned,
      policiesLearned: report.policiesLearned,
      contactsLearned: report.contactsLearned,
      embeddingsGenerated: report.embeddingsGenerated,
      relationshipsCreated: report.relationshipsCreated,
      trainingTimeMs: report.trainingTimeMs,
      categoryBreakdown: toJson(report.categoryBreakdown),
      overallConfidence: report.overallConfidence,
      errors: toJson(report.errors),
      warnings: toJson(report.warnings),
    };
    await this.prisma.trainingReport.upsert({
      where: { crawlJobId: report.crawlJobId },
      create: { crawlJobId: report.crawlJobId, ...data },
      update: data,
    });
  }

  async getTrainingReport(crawlJobId: string): Promise<TrainingReportData | null> {
    const row = await this.prisma.trainingReport.findUnique({ where: { crawlJobId } });
    if (!row) return null;
    return this.mapTrainingReport(row);
  }

  async listTrainingReports(installationId: string, limit = 20): Promise<TrainingReportData[]> {
    const rows = await this.prisma.trainingReport.findMany({
      where: { crawlJob: { installationId } },
      orderBy: { generatedAt: "desc" },
      take: limit,
    });
    return rows.map((r) => this.mapTrainingReport(r));
  }

  private mapTrainingReport(row: {
    crawlJobId: string;
    incremental: boolean;
    totalDocuments: number;
    totalPages: number;
    productsLearned: number;
    servicesLearned: number;
    faqsLearned: number;
    policiesLearned: number;
    contactsLearned: number;
    embeddingsGenerated: number;
    relationshipsCreated: number;
    trainingTimeMs: number;
    categoryBreakdown: unknown;
    overallConfidence: number;
    errors: unknown;
    warnings: unknown;
  }): TrainingReportData {
    return {
      crawlJobId: row.crawlJobId,
      incremental: row.incremental,
      totalDocuments: row.totalDocuments,
      totalPages: row.totalPages,
      productsLearned: row.productsLearned,
      servicesLearned: row.servicesLearned,
      faqsLearned: row.faqsLearned,
      policiesLearned: row.policiesLearned,
      contactsLearned: row.contactsLearned,
      embeddingsGenerated: row.embeddingsGenerated,
      relationshipsCreated: row.relationshipsCreated,
      trainingTimeMs: row.trainingTimeMs,
      categoryBreakdown: (row.categoryBreakdown ?? {}) as Record<string, number>,
      overallConfidence: row.overallConfidence,
      errors: readJsonArray<string>(row.errors),
      warnings: readJsonArray<string>(row.warnings),
    };
  }
}
