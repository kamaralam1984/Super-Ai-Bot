import crypto from "node:crypto";
import { runCrawlQueue, type CrawlQueueOptions } from "./crawl/crawlQueue";
import { discoverWebsite, extractAllLinks } from "./discovery/discoveryService";
import { fetchRobotsTxt } from "./discovery/robotsTxt";
import { safeFetch, safeFetchText } from "./http/safeFetch";
import { PerHostRateLimiter } from "./http/rateLimiter";
import { parsePageContent } from "./parse/htmlParser";
import { isLikelyJsShell, renderWithHeadlessBrowser } from "./parse/headlessRenderer";
import { classifyPageType } from "./parse/pageTypeClassifier";
import { detectProducts } from "./detect/productDetector";
import { detectServices } from "./detect/serviceDetector";
import { detectFaqs } from "./detect/faqDetector";
import { findDocumentLinks, type DiscoveredDocumentType } from "./documents/documentDiscovery";
import { processDocument } from "./documents/documentService";
import { runOcr } from "./ocr/ocrEngine";
import { detectPageLanguages } from "./language/languageDetector";
import { buildCleanText } from "./clean/contentCleaner";
import { DuplicateTracker } from "./clean/duplicateDetector";
import { generateCrawlReport, type PageOutcome, type CrawlReportOutput } from "./report/reportGenerator";
import { planIncrementalRecrawl } from "./recrawl/changeDetector";
import { ScanRecordService } from "./scanRecord.service";
import { logEvent } from "../utils/logger";
import { formatError } from "../utils/formatError";

export interface ScanOptions {
  maxDepth?: number;
  maxPages?: number;
  concurrency?: number;
  ocrImageLimit?: number;
}

export type ScanPhase = "discovering" | "crawling" | "processing_documents" | "generating_report" | "completed" | "failed";

export interface ScanProgressEvent {
  phase: ScanPhase;
  message: string;
  pagesProcessed?: number;
  pagesTotal?: number;
}

export interface ScanRunResult {
  crawlJobId: string;
  success: boolean;
  report: CrawlReportOutput | null;
  errorMessage: string | null;
}

const DEFAULT_OCR_IMAGE_LIMIT = 10;
const ICON_LIKE_IMAGE = /icon|logo|avatar|sprite|spinner/i;

/**
 * Phase 2's top-level pipeline. Wires Discovery → Crawl Queue → HTML
 * Parsing → Product/Service/FAQ Detection → Document Processing →
 * OCR/Language → Report Generation into one run, persisting raw extracted
 * data via ScanRecordService and streaming progress through the
 * caller-supplied `onProgress` callback (the HTTP layer adapts this to
 * Socket.IO, matching Phase 1's install progress engine).
 *
 * Deliberately stops at raw extraction — chunking, embedding, the vector
 * index, and everything else that turns this data into an AI-ready
 * knowledge base is Phase 3 (`backend/src/knowledge/`), which runs as its
 * own re-runnable stage over this run's `crawlJobId` rather than being
 * fused into the crawl itself. That separation is what makes versioning
 * and "rebuild the knowledge base without recrawling" possible.
 */
export async function runWebsiteScan(
  databaseUrl: string,
  installationId: string,
  websiteUrl: string,
  options: ScanOptions,
  onProgress: (event: ScanProgressEvent) => void
): Promise<ScanRunResult> {
  const records = new ScanRecordService(databaseUrl);
  const dedup = new DuplicateTracker();
  const pageOutcomes: PageOutcome[] = [];
  const documentTargets = new Map<string, DiscoveredDocumentType>();
  let productsFound = 0;
  let servicesFound = 0;
  let faqsFound = 0;
  let documentsFound = 0;
  let documentErrors = 0;
  let ocrImagesProcessed = 0;
  let unchangedPageCount = 0;
  let crawlJobId = "";

  const ocrLimit = options.ocrImageLimit ?? DEFAULT_OCR_IMAGE_LIMIT;

  try {
    onProgress({ phase: "discovering", message: `Discovering ${websiteUrl}...` });
    const discovery = await discoverWebsite(websiteUrl);
    const robots = await fetchRobotsTxt(discovery.baseUrl);

    // Incremental recrawl (Task 30): the previous completed run's page
    // hashes, keyed by URL. A page whose fresh contentHash matches is
    // unchanged since last time — its expensive knowledge re-chunking/
    // re-embedding is skipped (the fetch itself still happens; avoiding
    // that too would need per-page ETag storage, noted as a further
    // optimization in docs/SCANNER.md).
    const previousPages = await records.getPreviousPageHashes(installationId, websiteUrl);
    const previousHashByUrl = new Map(previousPages.map((p) => [p.url, p.contentHash]));

    crawlJobId = await records.createCrawlJob(installationId, websiteUrl, {
      maxDepth: options.maxDepth ?? 3,
      maxPages: options.maxPages ?? 200,
      concurrency: options.concurrency ?? 5,
    });
    await records.updateCrawlJobStatus(crawlJobId, "DISCOVERING", { techStack: discovery.techStack, sitemapUrls: discovery.sitemapUrls, robotsTxtContent: discovery.robotsTxtContent });
    await records.incrementCrawlJobCounters(crawlJobId, { discovered: discovery.seedUrls.length });
    await records.updateCrawlJobStatus(crawlJobId, "CRAWLING");
    onProgress({ phase: "crawling", message: "Crawling pages...", pagesTotal: discovery.seedUrls.length });

    const rateLimiter = new PerHostRateLimiter();
    if (robots.crawlDelayMs) {
      rateLimiter.setMinInterval(new URL(discovery.baseUrl).hostname, robots.crawlDelayMs);
    }

    const handler = async (url: string, depth: number): Promise<{ discoveredUrls: string[] }> => {
      const hostname = new URL(url).hostname;
      const fetchStart = performance.now();
      const fetched = await rateLimiter.schedule(hostname, () => safeFetchText(url, { timeoutMs: 15000 }));
      const loadTimeMs = Math.round(performance.now() - fetchStart);

      if (!fetched.result.ok) throw new Error(`HTTP ${fetched.result.statusCode}`);

      const contentTypeHeader = fetched.result.headers["content-type"];
      const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
      if (!contentType?.includes("text/html")) return { discoveredUrls: [] };

      let html = fetched.text;
      if (isLikelyJsShell(html)) {
        html = await renderWithHeadlessBrowser(url).catch(() => html);
      }

      const parsed = parsePageContent(html);
      const pageType = classifyPageType(url, parsed.title);
      const cleanText = buildCleanText(parsed);
      const contentHash = crypto.createHash("sha256").update(cleanText).digest("hex");
      // Headings too, not just <p> tags — some real-world page layouts
      // (e.g. product/category cards) put all the descriptive text in
      // headings and keep paragraphs to price/stock fragments alone, which
      // starves language detection of any real linguistic signal. List
      // items are deliberately excluded — nav/category menus are
      // concatenated labels, not prose, and reliably produce false-positive
      // "other language" reads (verified against a real product listing page).
      const languageSampleBlocks = [...parsed.headings.h1, ...parsed.headings.h2, ...parsed.headings.h3, ...parsed.paragraphs];
      const { primary: language } = detectPageLanguages(languageSampleBlocks);

      const duplicateOfUrl = dedup.check("page", cleanText, url);
      const pageId = await records.savePage(crawlJobId, url, depth, fetched.result.statusCode, "SUCCESS", contentHash, pageType, language.name, parsed, null);
      if (duplicateOfUrl) await records.markPageDuplicate(pageId, duplicateOfUrl);

      const isUnchangedSinceLastCrawl = previousHashByUrl.get(url) === contentHash;
      if (isUnchangedSinceLastCrawl && !duplicateOfUrl) {
        unchangedPageCount++;
        pageOutcomes.push({
          url,
          pageType,
          language: language.name,
          statusCode: fetched.result.statusCode,
          loadTimeMs,
          hasMetaTitle: Boolean(parsed.metaTitle),
          hasMetaDescription: Boolean(parsed.metaDescription),
          hasH1: parsed.headings.h1.length > 0,
          imageCount: parsed.images.length,
          imagesMissingAlt: parsed.images.filter((i) => !i.alt).length,
          formCount: parsed.forms.length,
        });
        await records.incrementCrawlJobCounters(crawlJobId, { crawled: 1 });
        onProgress({ phase: "crawling", message: `Unchanged since last crawl, skipped reprocessing: ${url}`, pagesProcessed: pageOutcomes.length, pagesTotal: discovery.seedUrls.length });
        const unchangedLinks = extractAllLinks(html, discovery.baseUrl);
        return { discoveredUrls: unchangedLinks.filter((l) => l.category === "internal").map((l) => l.url) };
      }

      const products = detectProducts(html, parsed.structuredData);
      const services = detectServices(html, parsed.structuredData);
      const faqs = detectFaqs(html, parsed.structuredData);
      await Promise.all([records.saveProducts(pageId, products), records.saveServices(pageId, services), records.saveFaqs(pageId, faqs)]);
      productsFound += products.length;
      servicesFound += services.length;
      faqsFound += faqs.length;

      // OCR happens here (it needs the actual image bytes, already being
      // fetched during the crawl) but chunking/embedding it does not — that
      // is Phase 3's job, reading `ocrResults` back out after the fact.
      // Bounded site-wide and skips obvious icons/logos; expensive at
      // ~seconds per image.
      const ocrResults: { imageUrl: string; text: string; confidence: number }[] = [];
      for (const img of parsed.images) {
        if (ocrImagesProcessed >= ocrLimit) break;
        if (ICON_LIKE_IMAGE.test(img.src)) continue;
        try {
          const imgUrl = new URL(img.src, url).toString();
          const imgResponse = await safeFetch(imgUrl, { timeoutMs: 10000, maxBytes: 8 * 1024 * 1024 });
          if (!imgResponse.ok) continue;
          ocrImagesProcessed++;
          const ocrResult = await runOcr(imgResponse.body, language.name);
          if (ocrResult.text) {
            ocrResults.push({ imageUrl: imgUrl, text: ocrResult.text, confidence: ocrResult.confidence });
          }
        } catch {
          // one bad image is not worth failing the page over
        }
      }
      if (ocrResults.length > 0) {
        await records.saveOcrResults(pageId, ocrResults);
      }

      const links = extractAllLinks(html, discovery.baseUrl);
      for (const doc of findDocumentLinks(links.map((l) => l.url))) {
        documentTargets.set(doc.url, doc.type);
      }

      pageOutcomes.push({
        url,
        pageType,
        language: language.name,
        statusCode: fetched.result.statusCode,
        loadTimeMs,
        hasMetaTitle: Boolean(parsed.metaTitle),
        hasMetaDescription: Boolean(parsed.metaDescription),
        hasH1: parsed.headings.h1.length > 0,
        imageCount: parsed.images.length,
        imagesMissingAlt: parsed.images.filter((i) => !i.alt).length,
        formCount: parsed.forms.length,
      });

      await records.incrementCrawlJobCounters(crawlJobId, { crawled: 1 });
      onProgress({ phase: "crawling", message: `Crawled ${url}`, pagesProcessed: pageOutcomes.length, pagesTotal: discovery.seedUrls.length });

      return { discoveredUrls: links.filter((l) => l.category === "internal").map((l) => l.url) };
    };

    const queueOptions: CrawlQueueOptions = {
      maxDepth: options.maxDepth ?? 3,
      maxPages: options.maxPages ?? 200,
      concurrency: options.concurrency ?? 5,
      maxRetries: 2,
      retryDelayMs: 1000,
    };

    const summary = await runCrawlQueue(discovery.seedUrls, handler, robots.isAllowed, queueOptions, (p) => {
      onProgress({ phase: "crawling", message: `Crawling — ${p.succeeded} ok, ${p.failed} failed, ${p.queued} queued`, pagesProcessed: p.processed });
    });

    if (summary.failedUrls.length > 0) {
      await records.incrementCrawlJobCounters(crawlJobId, { failed: summary.failedUrls.length });
    }

    await records.updateCrawlJobStatus(crawlJobId, "PROCESSING");
    onProgress({ phase: "processing_documents", message: `Processing ${documentTargets.size} linked document(s)...` });

    for (const [docUrl, docType] of documentTargets) {
      const result = await processDocument(docUrl, docType);
      const isDuplicate = result.extractedText.trim() ? Boolean(dedup.check("document", result.extractedText, docUrl)) : false;
      await records.saveDocument(crawlJobId, docUrl, docType, result, isDuplicate);

      if (result.errorMessage) documentErrors++;
      else documentsFound++;
      // Chunking/embedding this document's extractedText is Phase 3's job
      // (backend/src/knowledge/) — it reads ProcessedDocument rows directly.
    }

    onProgress({ phase: "generating_report", message: "Generating crawl report..." });
    const report = generateCrawlReport({
      baseUrl: discovery.baseUrl,
      techStack: discovery.techStack,
      robotsTxtFound: discovery.robotsTxtFound,
      totalDiscovered: discovery.seedUrls.length,
      pageOutcomes,
      failedUrls: summary.failedUrls,
      skippedUrls: summary.skippedUrls,
      productsFound,
      servicesFound,
      faqsFound,
      documentsFound,
      documentErrors,
      duplicatesSkipped: dedup.duplicateStats(),
      unchangedPageCount,
      durationMs: 0,
    });
    await records.saveReport(crawlJobId, report);
    await records.updateCrawlJobStatus(crawlJobId, "COMPLETED", { completedAt: new Date() });

    onProgress({ phase: "completed", message: "Scan complete." });
    logEvent({ component: "scan-orchestrator", message: `Scan completed for ${websiteUrl}: ${pageOutcomes.length} pages, ${productsFound} products, ${faqsFound} FAQs`, status: "success" });

    return { crawlJobId, success: true, report, errorMessage: null };
  } catch (err) {
    const message = formatError(err);
    logEvent({ component: "scan-orchestrator", message: `Scan failed for ${websiteUrl}`, status: "error", error: message });
    if (crawlJobId) {
      await records.updateCrawlJobStatus(crawlJobId, "FAILED", { errorMessage: message, completedAt: new Date() }).catch(() => undefined);
    }
    onProgress({ phase: "failed", message });
    return { crawlJobId, success: false, report: null, errorMessage: message };
  } finally {
    await records.close();
  }
}
