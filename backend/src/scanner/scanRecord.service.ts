import { PrismaClient, Prisma, type CrawlJobStatus, type PageCrawlStatus, type DocumentType } from "@prisma/client";
import type { ParsedPageContent } from "./parse/htmlParser";
import type { DetectedProduct } from "./detect/productDetector";
import type { DetectedService } from "./detect/serviceDetector";
import type { DetectedFaq } from "./detect/faqDetector";
import type { DiscoveredDocumentType } from "./documents/documentDiscovery";
import type { ProcessedDocumentResult } from "./documents/documentService";
import type { CrawlReportOutput } from "./report/reportGenerator";

/**
 * Prisma's Json input type requires a structural index signature that our
 * precise domain interfaces (HeadingSet, ContactInfo, ...) intentionally
 * don't have — they're still perfectly valid JSON at runtime. A JSON
 * round-trip both satisfies the type and sanitizes anything JSON can't
 * represent (undefined, etc.) before it hits the database.
 */
function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * One PrismaClient per crawl run (not per-write, unlike Phase 1's
 * short-lived-per-call pattern) — a crawl can produce hundreds of writes
 * across many pages, and opening/closing a connection per write would
 * dominate the runtime. `close()` must be called when the crawl finishes
 * or fails.
 */
export class ScanRecordService {
  private prisma: PrismaClient;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async createCrawlJob(installationId: string, websiteUrl: string, config: unknown): Promise<string> {
    const job = await this.prisma.crawlJob.create({
      data: { installationId, websiteUrl, status: "QUEUED", config: toJson(config) },
    });
    return job.id;
  }

  async updateCrawlJobStatus(
    crawlJobId: string,
    status: CrawlJobStatus,
    extra: { errorMessage?: string; techStack?: unknown; sitemapUrls?: string[]; robotsTxtContent?: string | null; completedAt?: Date } = {}
  ): Promise<void> {
    await this.prisma.crawlJob.update({
      where: { id: crawlJobId },
      data: {
        status,
        errorMessage: extra.errorMessage,
        techStack: extra.techStack ? toJson(extra.techStack) : undefined,
        sitemapUrls: extra.sitemapUrls ? toJson(extra.sitemapUrls) : undefined,
        robotsTxtContent: extra.robotsTxtContent === undefined ? undefined : extra.robotsTxtContent,
        completedAt: extra.completedAt,
      },
    });
  }

  async incrementCrawlJobCounters(crawlJobId: string, delta: { discovered?: number; crawled?: number; failed?: number }): Promise<void> {
    await this.prisma.crawlJob.update({
      where: { id: crawlJobId },
      data: {
        totalPagesDiscovered: delta.discovered ? { increment: delta.discovered } : undefined,
        totalPagesCrawled: delta.crawled ? { increment: delta.crawled } : undefined,
        totalPagesFailed: delta.failed ? { increment: delta.failed } : undefined,
      },
    });
  }

  async savePage(
    crawlJobId: string,
    url: string,
    depth: number,
    statusCode: number,
    crawlStatus: PageCrawlStatus,
    contentHash: string | null,
    pageType: string | null,
    language: string | null,
    parsed: ParsedPageContent | null,
    errorMessage: string | null
  ): Promise<string> {
    const page = await this.prisma.crawledPage.upsert({
      where: { crawlJobId_url: { crawlJobId, url } },
      create: {
        crawlJobId,
        url,
        canonicalUrl: parsed?.canonicalUrl ?? null,
        depth,
        statusCode,
        contentHash,
        pageType,
        crawlStatus,
        errorMessage,
        title: parsed?.title ?? null,
        metaTitle: parsed?.metaTitle ?? null,
        metaDescription: parsed?.metaDescription ?? null,
        language,
        headings: parsed?.headings ? toJson(parsed.headings) : undefined,
        paragraphs: parsed?.paragraphs ? toJson(parsed.paragraphs) : undefined,
        lists: parsed?.lists ? toJson(parsed.lists) : undefined,
        tables: parsed?.tables ? toJson(parsed.tables) : undefined,
        breadcrumbs: parsed?.breadcrumbs ? toJson(parsed.breadcrumbs) : undefined,
        contactInfo: parsed?.contactInfo ? toJson(parsed.contactInfo) : undefined,
        images: parsed?.images ? toJson(parsed.images) : undefined,
        videos: parsed?.videos ? toJson(parsed.videos) : undefined,
        forms: parsed?.forms ? toJson(parsed.forms) : undefined,
        ctaButtons: parsed?.ctaButtons ? toJson(parsed.ctaButtons) : undefined,
        structuredData: parsed?.structuredData ? toJson(parsed.structuredData) : undefined,
      },
      update: {
        statusCode,
        contentHash,
        pageType,
        crawlStatus,
        errorMessage,
        title: parsed?.title ?? null,
        language,
        fetchedAt: new Date(),
      },
    });
    return page.id;
  }

  async markPageDuplicate(pageId: string, duplicateOfUrl: string): Promise<void> {
    await this.prisma.crawledPage.update({ where: { id: pageId }, data: { isDuplicate: true, duplicateOfUrl } });
  }

  /** Raw OCR output, stored for Phase 3 to chunk later — no re-fetching the image needed. */
  async saveOcrResults(pageId: string, results: { imageUrl: string; text: string; confidence: number }[]): Promise<void> {
    await this.prisma.crawledPage.update({ where: { id: pageId }, data: { ocrResults: toJson(results) } });
  }

  async saveProducts(pageId: string, products: DetectedProduct[]): Promise<void> {
    if (products.length === 0) return;
    await this.prisma.extractedProduct.createMany({
      data: products.map((p) => ({
        pageId,
        name: p.name,
        category: p.category,
        price: p.price,
        currency: p.currency,
        discount: p.discount,
        description: p.description,
        specifications: p.specifications ?? undefined,
        features: p.features ?? undefined,
        images: p.images,
        sku: p.sku,
        brand: p.brand,
        stockStatus: p.stockStatus,
        rating: p.rating,
        reviewCount: p.reviewCount,
        source: p.source,
      })),
    });
  }

  async saveServices(pageId: string, services: DetectedService[]): Promise<void> {
    if (services.length === 0) return;
    await this.prisma.extractedService.createMany({
      data: services.map((s) => ({
        pageId,
        name: s.name,
        description: s.description,
        pricing: s.pricing,
        benefits: s.benefits ?? undefined,
        features: s.features ?? undefined,
        workflow: s.workflow ?? undefined,
        industries: s.industries ?? undefined,
        source: s.source,
      })),
    });
  }

  async saveFaqs(pageId: string, faqs: DetectedFaq[]): Promise<void> {
    if (faqs.length === 0) return;
    await this.prisma.extractedFaq.createMany({
      data: faqs.map((f) => ({ pageId, question: f.question, answer: f.answer, category: f.category, priority: f.priority, source: f.source })),
    });
  }

  async saveDocument(crawlJobId: string, sourceUrl: string, type: DiscoveredDocumentType, result: ProcessedDocumentResult, isDuplicate: boolean): Promise<string> {
    const doc = await this.prisma.processedDocument.upsert({
      where: { crawlJobId_sourceUrl: { crawlJobId, sourceUrl } },
      create: {
        crawlJobId,
        sourceUrl,
        documentType: type as DocumentType,
        extractedText: result.extractedText,
        contentHash: result.contentHash,
        pageCount: result.pageCount,
        isDuplicate,
        errorMessage: result.errorMessage,
        docMetadata: toJson(result.docMetadata),
        headings: toJson(result.headings),
        hyperlinks: toJson(result.hyperlinks),
        tables: toJson(result.tables),
      },
      update: {
        extractedText: result.extractedText,
        contentHash: result.contentHash,
        errorMessage: result.errorMessage,
        docMetadata: toJson(result.docMetadata),
        headings: toJson(result.headings),
        hyperlinks: toJson(result.hyperlinks),
        tables: toJson(result.tables),
        fetchedAt: new Date(),
      },
    });
    return doc.id;
  }

  async saveReport(crawlJobId: string, report: CrawlReportOutput): Promise<void> {
    await this.prisma.crawlReport.upsert({
      where: { crawlJobId },
      create: {
        crawlJobId,
        techStack: toJson(report.techStack),
        totalPages: report.totalPages,
        scannedPages: report.scannedPages,
        failedPages: report.failedPages,
        productsFound: report.productsFound,
        servicesFound: report.servicesFound,
        blogsFound: report.blogsFound,
        documentsFound: report.documentsFound,
        imagesFound: report.imagesFound,
        faqsFound: report.faqsFound,
        formsFound: report.formsFound,
        languages: toJson(report.languages),
        seoSummary: toJson(report.seoSummary),
        performanceSummary: toJson(report.performanceSummary),
        errors: toJson(report.errors),
        warnings: toJson(report.warnings),
        securityObservations: toJson(report.securityObservations),
      },
      update: {
        totalPages: report.totalPages,
        scannedPages: report.scannedPages,
        failedPages: report.failedPages,
        productsFound: report.productsFound,
        servicesFound: report.servicesFound,
        blogsFound: report.blogsFound,
        documentsFound: report.documentsFound,
        imagesFound: report.imagesFound,
        faqsFound: report.faqsFound,
        formsFound: report.formsFound,
        languages: toJson(report.languages),
        seoSummary: toJson(report.seoSummary),
        performanceSummary: toJson(report.performanceSummary),
        errors: toJson(report.errors),
        warnings: toJson(report.warnings),
        securityObservations: toJson(report.securityObservations),
      },
    });
  }

  async getPreviousPageHashes(installationId: string, websiteUrl: string): Promise<{ url: string; contentHash: string | null }[]> {
    const lastJob = await this.prisma.crawlJob.findFirst({
      where: { installationId, websiteUrl, status: "COMPLETED" },
      orderBy: { startedAt: "desc" },
    });
    if (!lastJob) return [];
    const pages = await this.prisma.crawledPage.findMany({ where: { crawlJobId: lastJob.id }, select: { url: true, contentHash: true } });
    return pages;
  }
}

/**
 * The installer (Phase 1) is single-tenant per deployment — there's exactly
 * one completed Installation per running instance. The scanner needs that
 * row's internal id (a cuid, not the human-readable installationId string)
 * to satisfy CrawlJob's foreign key, so it looks up the most recent
 * COMPLETED installation rather than requiring a caller to somehow already
 * know an id they have no other way to obtain.
 */
export async function getActiveInstallationId(databaseUrl: string): Promise<string | null> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const installation = await prisma.installation.findFirst({ where: { status: "COMPLETED" }, orderBy: { startedAt: "desc" } });
    return installation?.id ?? null;
  } finally {
    await prisma.$disconnect();
  }
}
