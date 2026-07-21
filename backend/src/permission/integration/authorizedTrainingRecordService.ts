// Authorized Training Record Service — the concrete answer to "update the
// AI Training Engine to consume authorized data from the Permission &
// Connector Engine instead of assuming direct access." Wraps
// training/trainingRecord.service.ts's TrainingRecordService and
// intercepts every read that returns customer business data (as opposed to
// crawl/page routing metadata, which stays a Phase 1/2 authorization
// boundary — see docs/PERMISSION_ENGINE.md) with a PermissionOrchestrator
// checkAccess call first.
//
// Design choice: a denied scope does not abort the whole training run — it
// degrades that one stage to "nothing learned for this category" (an empty
// array) so an administrator who authorized Products but not FAQs still
// gets product enrichment instead of a hard failure. Every check, allowed
// or denied, is still audit-logged by PermissionOrchestratorService.
// checkAccess itself. This mirrors the AI tool layer's existing philosophy
// of failing soft with a clear reason rather than throwing — see
// connector/tools/aiToolLayer.ts's ToolResult pattern — except here the
// "soft failure" is simply an empty result set, since these are internal
// pipeline reads, not a caller-facing tool call with its own error channel.

import { scopeForChunkCategory, scopeForPolicyType } from "../catalog/dataScopeCatalog";
import type { PermissionOrchestratorService } from "../permissionOrchestrator.service";
import type { DataScope } from "../types";
import type {
  ChunkForRelationships,
  FaqDbRecord,
  KnowledgeRelationshipRecord,
  ProductRecord,
  ServiceRecord,
  TrainingPageRecord,
  TrainingRecordService,
} from "../../training/trainingRecord.service";
import type { CurrentPageRecord, PreviousPageRecord } from "../../scanner/recrawl/changeDetector";
import type { ExistingChunkRef } from "../../knowledge/update/autoUpdateEngine";
import type { ExtractedContactDraft, ExtractedPolicyDraft, KnowledgeRelationshipDraft, RelatedEntityRef, TrainingReportData } from "../../training/types";

export interface TrainingAccessSummary {
  dataScope: DataScope;
  allowed: boolean;
  reason: string;
}

/** Entity-type → DataScope mapping for KnowledgeRelationship rows. "Chunk" and "Category" have no single owning scope (a Chunk's real category would need a join this table doesn't carry) and are left ungated — a documented limitation, not an oversight. */
const RELATIONSHIP_ENTITY_TO_SCOPE: Partial<Record<string, DataScope>> = {
  Product: "PRODUCTS",
  Service: "SERVICES",
  Faq: "FAQS",
  Policy: "SUPPORT_ARTICLES",
  Contact: "SUPPORT_ARTICLES",
};

export class AuthorizedTrainingRecordService {
  private accessLog: TrainingAccessSummary[] = [];

  constructor(
    private readonly inner: TrainingRecordService,
    private readonly permissions: PermissionOrchestratorService,
    private readonly installationId: string
  ) {}

  /** Every scope decision made during this training run, allowed and denied alike — folded into the persisted TrainingReport so "what was the AI authorized to learn from this run" is answerable without cross-referencing the audit log. */
  getAccessSummary(): TrainingAccessSummary[] {
    return this.accessLog;
  }

  private async isAllowed(dataScope: DataScope): Promise<boolean> {
    const decision = await this.permissions.checkAccess({ installationId: this.installationId, dataScope, purpose: "ai_training" });
    this.accessLog.push({ dataScope, allowed: decision.allowed, reason: decision.reason });
    return decision.allowed;
  }

  async close(): Promise<void> {
    await this.inner.close();
  }

  // ── Unscoped — crawl/page routing metadata, not gated business data ──
  // (general crawled website content is a Phase 1/2 authorization boundary
  // the customer already crossed by installing the product and running a
  // scan; see docs/PERMISSION_ENGINE.md)

  async getCurrentPages(crawlJobId: string): Promise<CurrentPageRecord[]> {
    return this.inner.getCurrentPages(crawlJobId);
  }

  async getPreviousCompletedCrawlJobPages(installationId: string, websiteUrl: string, excludeCrawlJobId: string): Promise<PreviousPageRecord[]> {
    return this.inner.getPreviousCompletedCrawlJobPages(installationId, websiteUrl, excludeCrawlJobId);
  }

  async getExistingChunkRefs(installationId: string): Promise<ExistingChunkRef[]> {
    return this.inner.getExistingChunkRefs(installationId);
  }

  async getContentUnitsForValidation(crawlJobId: string): Promise<Array<{ sourceUrl: string; content: string }>> {
    return this.inner.getContentUnitsForValidation(crawlJobId);
  }

  async getPagesForCrawlJob(crawlJobId: string): Promise<TrainingPageRecord[]> {
    return this.inner.getPagesForCrawlJob(crawlJobId);
  }

  async getDocumentCount(crawlJobId: string): Promise<number> {
    return this.inner.getDocumentCount(crawlJobId);
  }

  // ── Scoped reads ─────────────────────────────────────────────────────

  async getProductsForInstallation(installationId: string): Promise<ProductRecord[]> {
    if (!(await this.isAllowed("PRODUCTS"))) return [];
    return this.inner.getProductsForInstallation(installationId);
  }

  async getServicesForInstallation(installationId: string): Promise<ServiceRecord[]> {
    if (!(await this.isAllowed("SERVICES"))) return [];
    return this.inner.getServicesForInstallation(installationId);
  }

  async getFaqsForInstallation(installationId: string): Promise<FaqDbRecord[]> {
    if (!(await this.isAllowed("FAQS"))) return [];
    return this.inner.getFaqsForInstallation(installationId);
  }

  /** Filters per-row by policyType → scope (Shipping vs. Support Articles) rather than an all-or-nothing gate, since a single training run's policy set can legitimately span both. */
  async getPoliciesForInstallation(installationId: string): Promise<Array<{ id: string; pageId: string; title: string | null; content: string }>> {
    const rows = await this.inner.getPoliciesForInstallation(installationId);
    const neededScopes = Array.from(new Set(rows.map((r) => scopeForPolicyType(r.policyType))));
    const allowedScopes = new Set<DataScope>();
    for (const scope of neededScopes) {
      if (await this.isAllowed(scope)) allowedScopes.add(scope);
    }
    return rows.filter((r) => allowedScopes.has(scopeForPolicyType(r.policyType)));
  }

  /** Contacts have no per-row scope signal finer than "support/company contact info," so they're gated as a whole under Support Articles. */
  async getContactsForInstallation(installationId: string): Promise<Array<{ id: string; pageId: string }>> {
    if (!(await this.isAllowed("SUPPORT_ARTICLES"))) return [];
    return this.inner.getContactsForInstallation(installationId);
  }

  /** `category` is a free-text Phase 3 classification, only some of which map to a wizard scope (see catalog/dataScopeCatalog.ts's scopeForChunkCategory) — an unmapped category (e.g. "Company") is general site content and stays ungated. */
  async getChunksByCategory(installationId: string, category: string): Promise<ChunkForRelationships[]> {
    const scope = scopeForChunkCategory(category);
    if (scope && !(await this.isAllowed(scope))) return [];
    return this.inner.getChunksByCategory(installationId, category);
  }

  async getAllLiveChunksForQualityCheck(
    installationId: string
  ): Promise<Array<{ id: string; content: string; category: string | null; confidenceScore: number; isDuplicate: boolean; duplicateOfChunkId: string | null }>> {
    const rows = await this.inner.getAllLiveChunksForQualityCheck(installationId);
    const neededScopes = Array.from(new Set(rows.map((r) => scopeForChunkCategory(r.category)).filter((s): s is DataScope => s !== null)));
    const allowedScopes = new Set<DataScope>();
    for (const scope of neededScopes) {
      if (await this.isAllowed(scope)) allowedScopes.add(scope);
    }
    return rows.filter((r) => {
      const scope = scopeForChunkCategory(r.category);
      return scope === null || allowedScopes.has(scope);
    });
  }

  async getRelationshipsForInstallation(installationId: string): Promise<KnowledgeRelationshipRecord[]> {
    const rows = await this.inner.getRelationshipsForInstallation(installationId);
    const entityTypes = Array.from(new Set([...rows.map((r) => r.sourceType), ...rows.map((r) => r.targetType)]));
    const neededScopes = Array.from(new Set(entityTypes.map((t) => RELATIONSHIP_ENTITY_TO_SCOPE[t]).filter((s): s is DataScope => !!s)));
    const allowedScopes = new Set<DataScope>();
    for (const scope of neededScopes) {
      if (await this.isAllowed(scope)) allowedScopes.add(scope);
    }
    return rows.filter((r) => {
      const sourceScope = RELATIONSHIP_ENTITY_TO_SCOPE[r.sourceType];
      const targetScope = RELATIONSHIP_ENTITY_TO_SCOPE[r.targetType];
      const sourceOk = !sourceScope || allowedScopes.has(sourceScope);
      const targetOk = !targetScope || allowedScopes.has(targetScope);
      return sourceOk && targetOk;
    });
  }

  // ── Writes — pass through unchanged. Access to the underlying data was
  // already checked in the read that produced whatever's being written in
  // the same pipeline stage; there is no separate "write scope" to check
  // (the engine only ever grants READ_ONLY — see policy/
  // leastPrivilegePolicy.ts — ­these writes are the AI's own derived
  // learning artifacts, not a write back to a source system). ────────────

  async saveContacts(pageId: string, drafts: ExtractedContactDraft[]): Promise<string[]> {
    return this.inner.saveContacts(pageId, drafts);
  }

  async savePolicies(pageId: string, drafts: ExtractedPolicyDraft[]): Promise<string[]> {
    return this.inner.savePolicies(pageId, drafts);
  }

  async updateProductEnrichment(productId: string, data: { benefits: string[] | null; availability: string; relatedProducts: RelatedEntityRef[] }): Promise<void> {
    return this.inner.updateProductEnrichment(productId, data);
  }

  async updateServiceEnrichment(serviceId: string, data: { relatedServices: RelatedEntityRef[]; dependencies: string[] | null }): Promise<void> {
    return this.inner.updateServiceEnrichment(serviceId, data);
  }

  async updateFaqEnrichment(faqId: string, data: { confidence: number; similarQuestions: RelatedEntityRef[]; relatedQuestions: RelatedEntityRef[]; mergedFaqIds: string[] | null }): Promise<void> {
    return this.inner.updateFaqEnrichment(faqId, data);
  }

  async applyFaqMerge(canonicalId: string, mergedFaqId: string): Promise<void> {
    return this.inner.applyFaqMerge(canonicalId, mergedFaqId);
  }

  async setFaqCanonical(faqId: string): Promise<void> {
    return this.inner.setFaqCanonical(faqId);
  }

  async saveRelationships(installationId: string, drafts: KnowledgeRelationshipDraft[]): Promise<number> {
    return this.inner.saveRelationships(installationId, drafts);
  }

  async saveTrainingReport(report: TrainingReportData): Promise<void> {
    return this.inner.saveTrainingReport(report);
  }
}
