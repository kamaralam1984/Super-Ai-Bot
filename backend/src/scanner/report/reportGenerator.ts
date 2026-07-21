import type { TechStackSignals } from "../discovery/techStack";

export interface PageOutcome {
  url: string;
  pageType: string | null;
  language: string | null;
  statusCode: number | null;
  loadTimeMs: number | null;
  hasMetaTitle: boolean;
  hasMetaDescription: boolean;
  hasH1: boolean;
  imageCount: number;
  imagesMissingAlt: number;
  formCount: number;
}

export interface CrawlReportInput {
  baseUrl: string;
  techStack: TechStackSignals;
  robotsTxtFound: boolean;
  totalDiscovered: number;
  pageOutcomes: PageOutcome[];
  failedUrls: { url: string; error: string }[];
  skippedUrls: { url: string; reason: string }[];
  productsFound: number;
  servicesFound: number;
  faqsFound: number;
  documentsFound: number;
  documentErrors: number;
  duplicatesSkipped: Record<string, number>;
  unchangedPageCount: number;
  durationMs: number;
}

export interface CrawlReportOutput {
  websiteInfo: { baseUrl: string; robotsTxtFound: boolean };
  techStack: TechStackSignals;
  totalPages: number;
  scannedPages: number;
  failedPages: number;
  productsFound: number;
  servicesFound: number;
  blogsFound: number;
  documentsFound: number;
  imagesFound: number;
  faqsFound: number;
  formsFound: number;
  languages: Record<string, number>;
  seoSummary: {
    pagesMissingMetaTitle: number;
    pagesMissingMetaDescription: number;
    pagesMissingH1: number;
    imagesMissingAlt: number;
  };
  performanceSummary: { averageLoadTimeMs: number | null; slowestPages: { url: string; loadTimeMs: number }[] };
  errors: { url: string; error: string }[];
  warnings: string[];
  securityObservations: string[];
}

/** Pure aggregation — takes everything the orchestrator accumulated during a crawl and shapes it into the spec's report format. No I/O. */
export function generateCrawlReport(input: CrawlReportInput): CrawlReportOutput {
  const languages: Record<string, number> = {};
  for (const page of input.pageOutcomes) {
    if (page.language) languages[page.language] = (languages[page.language] ?? 0) + 1;
  }

  const blogsFound = input.pageOutcomes.filter((p) => p.pageType === "blog").length;
  const imagesFound = input.pageOutcomes.reduce((sum, p) => sum + p.imageCount, 0);
  const formsFound = input.pageOutcomes.reduce((sum, p) => sum + p.formCount, 0);

  const loadTimes = input.pageOutcomes.filter((p) => p.loadTimeMs != null).map((p) => p.loadTimeMs as number);
  const averageLoadTimeMs = loadTimes.length > 0 ? Math.round(loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length) : null;
  const slowestPages = [...input.pageOutcomes]
    .filter((p) => p.loadTimeMs != null)
    .sort((a, b) => (b.loadTimeMs as number) - (a.loadTimeMs as number))
    .slice(0, 5)
    .map((p) => ({ url: p.url, loadTimeMs: p.loadTimeMs as number }));

  const warnings: string[] = [];
  if (!input.robotsTxtFound) warnings.push("No robots.txt found — crawl proceeded treating all pages as allowed.");
  if (input.unchangedPageCount > 0) {
    warnings.push(`${input.unchangedPageCount} page(s) unchanged since the last crawl — reprocessing (re-detection, re-embedding) was skipped for them.`);
  }
  if (input.skippedUrls.length > 0) warnings.push(`${input.skippedUrls.length} URL(s) skipped (disallowed by robots.txt or over the page cap).`);
  const totalDuplicates = Object.values(input.duplicatesSkipped).reduce((a, b) => a + b, 0);
  if (totalDuplicates > 0) {
    const breakdown = Object.entries(input.duplicatesSkipped).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ");
    warnings.push(`${totalDuplicates} duplicate item(s) excluded from the knowledge base (${breakdown}).`);
  }
  if (input.documentErrors > 0) warnings.push(`${input.documentErrors} linked document(s) failed to process.`);

  const securityObservations: string[] = [];
  if (!input.techStack.server) securityObservations.push("Server header not disclosed — no immediate concern, noted for completeness.");
  if (input.techStack.cms) securityObservations.push(`Detected CMS: ${input.techStack.cms} — verify it's kept up to date.`);
  const pagesWithForms = input.pageOutcomes.filter((p) => p.formCount > 0).length;
  if (pagesWithForms > 0) securityObservations.push(`${pagesWithForms} page(s) contain forms — confirm they use HTTPS submission and CSRF protection.`);

  return {
    websiteInfo: { baseUrl: input.baseUrl, robotsTxtFound: input.robotsTxtFound },
    techStack: input.techStack,
    totalPages: input.totalDiscovered,
    scannedPages: input.pageOutcomes.length,
    failedPages: input.failedUrls.length,
    productsFound: input.productsFound,
    servicesFound: input.servicesFound,
    blogsFound,
    documentsFound: input.documentsFound,
    imagesFound,
    faqsFound: input.faqsFound,
    formsFound,
    languages,
    seoSummary: {
      pagesMissingMetaTitle: input.pageOutcomes.filter((p) => !p.hasMetaTitle).length,
      pagesMissingMetaDescription: input.pageOutcomes.filter((p) => !p.hasMetaDescription).length,
      pagesMissingH1: input.pageOutcomes.filter((p) => !p.hasH1).length,
      imagesMissingAlt: input.pageOutcomes.reduce((sum, p) => sum + p.imagesMissingAlt, 0),
    },
    performanceSummary: { averageLoadTimeMs, slowestPages },
    errors: input.failedUrls,
    warnings,
    securityObservations,
  };
}
