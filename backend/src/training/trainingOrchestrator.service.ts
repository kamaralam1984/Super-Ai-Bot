import { runKnowledgeBuild } from "../knowledge/knowledgeBuilder.service";
import { embedTexts } from "../knowledge/embed/embeddings";
import { formatError } from "../utils/formatError";

import { planIncrementalTraining } from "./incremental/incrementalTrainer";
import { validateBatch } from "./validate/knowledgeValidator";
import { extractContact } from "./extract/contactExtractor";
import { extractPolicy } from "./extract/policyExtractor";
import { normalizeAvailability, extractBenefits, computeRelatedProducts, type ProductForEnrichment } from "./extract/productLearning";
import { computeRelatedServices, extractDependencies, type ServiceForEnrichment } from "./extract/serviceLearning";
import { computeFaqConfidence, planFaqMerges, computeSimilarAndRelatedQuestions, type FaqRecord } from "./extract/faqLearning";
import { buildKnowledgeRelationships } from "./relationships/relationshipEngine";
import { runQualityChecks } from "./quality/qualityValidator";
import { generateTrainingReport } from "./report/trainingReportGenerator";
import { TrainingRecordService } from "./trainingRecord.service";
import { AuthorizedTrainingRecordService, type TrainingAccessSummary } from "../permission/integration/authorizedTrainingRecordService";
import { PermissionOrchestratorService } from "../permission/permissionOrchestrator.service";
import type { ContactInfo } from "../scanner/parse/contactExtractor";
import type { TrainingReportData } from "./types";

export interface TrainingProgressEvent {
  step: string;
  message: string;
  percent: number;
}

export interface TrainingChunkStats {
  chunksAdded: number;
  chunksUpdated: number;
  chunksRemoved: number;
  chunksDuplicate: number;
}

export interface TrainingResult {
  success: boolean;
  crawlJobId: string;
  report?: TrainingReportData;
  errorMessage?: string;
  /** Every Permission Engine access decision made during this run — which data categories the AI was and wasn't authorized to learn from. See permission/integration/authorizedTrainingRecordService.ts. */
  accessSummary?: TrainingAccessSummary[];
  /** Raw chunk-level counts from Phase 3's runKnowledgeBuild, carried through for monitor/monitorOrchestrator.service.ts's post-training comparison report — this pipeline is the only place that ever computes them, so they're threaded out here rather than recomputed. */
  chunkStats?: TrainingChunkStats;
}

/**
 * Top-level Phase 6 pipeline. Reuses Phase 3's `runKnowledgeBuild` as-is
 * for the core chunk/categorize/embed/dedup/score/version/index work
 * (that pipeline is already production-built — see docs/KNOWLEDGE_BUILDER.md)
 * and adds everything genuinely new on top: an explicit pre-flight
 * validation pass, incremental-scope planning, structured Contact/Policy
 * extraction, Product/Service/FAQ enrichment, the knowledge relationship
 * graph, post-hoc quality checks, and a persisted training report.
 *
 * Every read of customer business data (products/services/FAQs/policies/
 * contacts/category-scoped chunks/relationships) is gated by Phase 7's
 * Permission Engine via AuthorizedTrainingRecordService — this pipeline no
 * longer assumes direct, unmediated access to TrainingRecordService's
 * Prisma reads. See docs/PERMISSION_ENGINE.md.
 */
export async function runAiTraining(databaseUrl: string, crawlJobId: string, onProgress: (event: TrainingProgressEvent) => void): Promise<TrainingResult> {
  const startedAt = Date.now();
  const rawRecords = new TrainingRecordService(databaseUrl);
  const permissions = new PermissionOrchestratorService(databaseUrl);
  let records: AuthorizedTrainingRecordService | undefined;
  try {
    onProgress({ step: "plan", message: "Planning training scope", percent: 3 });
    // Crawl-job → installation/website routing metadata, not gated business
    // data — read directly off the raw record service before the
    // permission-checked wrapper (which needs installationId to construct)
    // exists yet.
    const { installationId, websiteUrl } = await rawRecords.getCrawlJobMeta(crawlJobId);
    records = new AuthorizedTrainingRecordService(rawRecords, permissions, installationId);
    const [currentPages, previousPages, existingChunkRefs] = await Promise.all([
      records.getCurrentPages(crawlJobId),
      records.getPreviousCompletedCrawlJobPages(installationId, websiteUrl, crawlJobId),
      records.getExistingChunkRefs(installationId),
    ]);
    const incrementalPlan = planIncrementalTraining({ previousPages, currentPages, existingChunks: existingChunkRefs });

    onProgress({ step: "validate", message: "Validating raw knowledge units", percent: 6 });
    const contentUnits = await records.getContentUnitsForValidation(crawlJobId);
    const validation = validateBatch(contentUnits);

    onProgress({ step: "build", message: incrementalPlan.isIncremental ? "Running incremental knowledge build" : "Running full knowledge build", percent: 10 });
    const buildResult = await runKnowledgeBuild(
      databaseUrl,
      crawlJobId,
      (event) => onProgress({ step: "build", message: event.message, percent: 10 + Math.round((event.percent / 100) * 55) }),
      incrementalPlan.isIncremental ? { allowedUrls: incrementalPlan.allowedUrls, chunkIdsToRemove: incrementalPlan.chunkIdsToRemove } : undefined
    );
    if (!buildResult.success) {
      throw new Error(buildResult.errorMessage ?? "Knowledge build failed");
    }

    onProgress({ step: "contacts", message: "Extracting structured contact information", percent: 68 });
    const pages = await records.getPagesForCrawlJob(crawlJobId);
    let contactsLearned = 0;
    for (const page of pages) {
      const draft = extractContact({ title: page.title, contactInfo: (page.contactInfo as unknown as ContactInfo) ?? null });
      if (draft) {
        const ids = await records.saveContacts(page.id, [draft]);
        contactsLearned += ids.length;
      }
    }

    onProgress({ step: "policies", message: "Extracting policy sub-types", percent: 71 });
    const policyChunks = await records.getChunksByCategory(installationId, "Policies");
    let policiesLearned = 0;
    for (const chunk of policyChunks) {
      if (!chunk.pageId) continue;
      const draft = extractPolicy({ content: chunk.content, title: chunk.title, sourceUrl: "" });
      if (draft) {
        await records.savePolicies(chunk.pageId, [draft]);
        policiesLearned++;
      }
    }

    onProgress({ step: "products", message: "Enriching product knowledge", percent: 74 });
    const products = await records.getProductsForInstallation(installationId);
    let embeddingsGenerated = buildResult.chunksCreated + buildResult.chunksUpdated;
    if (products.length > 0) {
      const productVectors = await embedTexts(products.map((p) => `${p.name} ${p.description ?? ""}`));
      embeddingsGenerated += productVectors.length;
      const productEntities: ProductForEnrichment[] = products.map((p, i) => ({ id: p.id, name: p.name, category: p.category, embedding: productVectors[i] }));
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const availability = normalizeAvailability(product.stockStatus, product.description);
        const benefits = extractBenefits(product.description);
        const relatedProducts = computeRelatedProducts(productEntities[i], productEntities);
        await records.updateProductEnrichment(product.id, { benefits, availability, relatedProducts });
      }
    }

    onProgress({ step: "services", message: "Enriching service knowledge", percent: 78 });
    const services = await records.getServicesForInstallation(installationId);
    if (services.length > 0) {
      const serviceVectors = await embedTexts(services.map((s) => `${s.name} ${s.description ?? ""}`));
      embeddingsGenerated += serviceVectors.length;
      const serviceEntities: ServiceForEnrichment[] = services.map((s, i) => ({ id: s.id, name: s.name, industries: s.industries, embedding: serviceVectors[i] }));
      for (let i = 0; i < services.length; i++) {
        const service = services[i];
        const workflowText = Array.isArray(service.workflow) ? (service.workflow as unknown[]).filter((w): w is string => typeof w === "string") : null;
        const dependencies = extractDependencies(service.description, workflowText);
        const relatedServices = computeRelatedServices(serviceEntities[i], serviceEntities);
        await records.updateServiceEnrichment(service.id, { relatedServices, dependencies });
      }
    }

    onProgress({ step: "faqs", message: "Enriching FAQ knowledge", percent: 82 });
    const faqRows = await records.getFaqsForInstallation(installationId);
    let faqsLearned = 0;
    let faqEntities: FaqRecord[] = [];
    if (faqRows.length > 0) {
      const faqVectors = await embedTexts(faqRows.map((f) => `${f.question} ${f.answer}`));
      embeddingsGenerated += faqVectors.length;
      faqEntities = faqRows.map((f, i) => ({ id: f.id, question: f.question, answer: f.answer, source: f.source, isDuplicate: f.isDuplicate, duplicateOfFaqId: f.duplicateOfFaqId, embedding: faqVectors[i] }));

      // planFaqMerges can choose a DIFFERENT canonical than Phase 3's own
      // initial dedup pass did (e.g. preferring a structured_data source
      // over Phase 3's plain "longest content wins" rule) — the
      // newly-chosen canonical may itself still carry a stale
      // isDuplicate:true from being a non-canonical member of Phase 3's
      // original clustering. Both the DB row and this run's in-memory
      // faqEntities (which the enrichment loop below reads) need to
      // reflect Phase 6's final decision, not Phase 3's superseded one —
      // caught by a real end-to-end run where the best-quality FAQ in a
      // cluster ended up permanently excluded as "just a duplicate."
      const mergePlans = planFaqMerges(faqEntities);
      const mergedCountByFaqId = new Map<string, number>();
      const isDuplicateOverride = new Map<string, boolean>();
      for (const plan of mergePlans) {
        mergedCountByFaqId.set(plan.canonicalId, plan.mergedFaqIds.length);
        isDuplicateOverride.set(plan.canonicalId, false);
        await records.setFaqCanonical(plan.canonicalId);
        for (const mergedId of plan.mergedFaqIds) {
          isDuplicateOverride.set(mergedId, true);
          await records.applyFaqMerge(plan.canonicalId, mergedId);
        }
      }
      for (const faq of faqEntities) {
        const override = isDuplicateOverride.get(faq.id);
        if (override !== undefined) faq.isDuplicate = override;
      }

      for (const faq of faqEntities) {
        if (faq.isDuplicate) continue; // only the canonical of each cluster carries the enrichment fields
        const mergedCount = mergedCountByFaqId.get(faq.id) ?? 0;
        const confidence = computeFaqConfidence(faq, mergedCount);
        const { similarQuestions, relatedQuestions } = computeSimilarAndRelatedQuestions(faq, faqEntities);
        const mergePlan = mergePlans.find((p) => p.canonicalId === faq.id);
        await records.updateFaqEnrichment(faq.id, { confidence, similarQuestions, relatedQuestions, mergedFaqIds: mergePlan?.mergedFaqIds ?? null });
        faqsLearned++;
      }
    }

    onProgress({ step: "relationships", message: "Building the knowledge relationship graph", percent: 88 });
    const finalProducts = await records.getProductsForInstallation(installationId);
    const finalServices = await records.getServicesForInstallation(installationId);
    const policies = await records.getPoliciesForInstallation(installationId);
    const contacts = await records.getContactsForInstallation(installationId);
    const blogChunks = await records.getChunksByCategory(installationId, "Blogs");
    const companyChunks = await records.getChunksByCategory(installationId, "Company");

    const [productEmb, serviceEmb, faqEmb, policyEmb, blogEmb] = await Promise.all([
      finalProducts.length > 0 ? embedTexts(finalProducts.map((p) => `${p.name} ${p.description ?? ""}`)) : Promise.resolve([]),
      finalServices.length > 0 ? embedTexts(finalServices.map((s) => `${s.name} ${s.description ?? ""}`)) : Promise.resolve([]),
      faqEntities.length > 0 ? Promise.resolve(faqEntities.map((f) => f.embedding)) : Promise.resolve([]),
      policies.length > 0 ? embedTexts(policies.map((p) => `${p.title ?? ""} ${p.content}`)) : Promise.resolve([]),
      blogChunks.length > 0 ? embedTexts(blogChunks.map((b) => `${b.title ?? ""} ${b.content}`)) : Promise.resolve([]),
    ]);
    embeddingsGenerated += productEmb.length + serviceEmb.length + policyEmb.length + blogEmb.length;

    const relationshipDrafts = buildKnowledgeRelationships({
      products: finalProducts.map((p, i) => ({ id: p.id, name: p.name, category: p.category, embedding: productEmb[i] ?? [], relatedProducts: [] })),
      services: finalServices.map((s, i) => ({ id: s.id, name: s.name, industries: s.industries, embedding: serviceEmb[i] ?? [], relatedServices: [] })),
      faqs: faqEntities.map((f, i) => ({ id: f.id, question: f.question, answer: f.answer, embedding: faqEmb[i] ?? f.embedding })),
      policies: policies.map((p, i) => ({ id: p.id, title: p.title, content: p.content, embedding: policyEmb[i] ?? [] })),
      blogs: blogChunks.map((b, i) => ({ id: b.id, title: b.title, content: b.content, embedding: blogEmb[i] ?? [] })),
      contacts: contacts.map((c) => ({ id: c.id, pageId: c.pageId })),
      companyChunks: companyChunks.map((c) => ({ id: c.id, pageId: c.pageId })),
    });
    const relationshipsCreated = await records.saveRelationships(installationId, relationshipDrafts);

    onProgress({ step: "quality", message: "Running post-training quality checks", percent: 93 });
    const liveChunks = await records.getAllLiveChunksForQualityCheck(installationId);
    const savedRelationships = await records.getRelationshipsForInstallation(installationId);
    const qualityIssues = runQualityChecks({
      chunks: liveChunks,
      relationships: savedRelationships,
      knownEntityIds: {
        Product: new Set(finalProducts.map((p) => p.id)),
        Service: new Set(finalServices.map((s) => s.id)),
        Faq: new Set(faqRows.map((f) => f.id)),
        Policy: new Set(policies.map((p) => p.id)),
        Contact: new Set(contacts.map((c) => c.id)),
        Chunk: new Set(liveChunks.map((c) => c.id)),
      },
    });

    onProgress({ step: "report", message: "Generating training report", percent: 97 });
    const totalDocuments = await records.getDocumentCount(crawlJobId);
    const report = generateTrainingReport({
      crawlJobId,
      incremental: incrementalPlan.isIncremental,
      totalDocuments,
      totalPages: pages.length,
      productsLearned: finalProducts.length,
      servicesLearned: finalServices.length,
      faqsLearned,
      policiesLearned,
      contactsLearned,
      embeddingsGenerated,
      relationshipsCreated,
      trainingTimeMs: Date.now() - startedAt,
      chunkCategories: liveChunks.map((c) => c.category).filter((c): c is string => c !== null),
      chunkConfidences: liveChunks.map((c) => c.confidenceScore),
      validationIssues: validation.issues,
      qualityIssues,
    });
    await records.saveTrainingReport(report);

    onProgress({ step: "done", message: "AI training complete", percent: 100 });
    return {
      success: true,
      crawlJobId,
      report,
      accessSummary: records.getAccessSummary(),
      chunkStats: { chunksAdded: buildResult.chunksCreated, chunksUpdated: buildResult.chunksUpdated, chunksRemoved: buildResult.chunksRemoved ?? 0, chunksDuplicate: buildResult.duplicatesFound },
    };
  } catch (err) {
    const message = formatError(err);
    onProgress({ step: "error", message, percent: 100 });
    return { success: false, crawlJobId, errorMessage: message, accessSummary: records?.getAccessSummary() };
  } finally {
    await rawRecords.close();
    await permissions.close();
  }
}
