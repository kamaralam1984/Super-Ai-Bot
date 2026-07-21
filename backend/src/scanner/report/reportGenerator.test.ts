import { describe, it, expect } from "vitest";
import { generateCrawlReport, type CrawlReportInput, type PageOutcome } from "./reportGenerator";

function page(overrides: Partial<PageOutcome> = {}): PageOutcome {
  return {
    url: "https://acme.com/",
    pageType: "home",
    language: "English",
    statusCode: 200,
    loadTimeMs: 200,
    hasMetaTitle: true,
    hasMetaDescription: true,
    hasH1: true,
    imageCount: 2,
    imagesMissingAlt: 0,
    formCount: 0,
    ...overrides,
  };
}

function baseInput(overrides: Partial<CrawlReportInput> = {}): CrawlReportInput {
  return {
    baseUrl: "https://acme.com",
    techStack: { cms: "WordPress", frameworks: [], server: "nginx", ecommerce: null, confidence: "high" },
    robotsTxtFound: true,
    totalDiscovered: 10,
    pageOutcomes: [page()],
    failedUrls: [],
    skippedUrls: [],
    productsFound: 0,
    servicesFound: 0,
    faqsFound: 0,
    documentsFound: 0,
    documentErrors: 0,
    duplicatesSkipped: {},
    unchangedPageCount: 0,
    durationMs: 5000,
    ...overrides,
  };
}

describe("generateCrawlReport", () => {
  it("aggregates basic counts correctly", () => {
    const report = generateCrawlReport(baseInput({ productsFound: 5, servicesFound: 2, faqsFound: 8, documentsFound: 3 }));
    expect(report.productsFound).toBe(5);
    expect(report.servicesFound).toBe(2);
    expect(report.faqsFound).toBe(8);
    expect(report.documentsFound).toBe(3);
    expect(report.scannedPages).toBe(1);
    expect(report.totalPages).toBe(10);
  });

  it("counts blog pages from pageType and sums images/forms across pages", () => {
    const report = generateCrawlReport(
      baseInput({
        pageOutcomes: [
          page({ pageType: "blog", imageCount: 3, formCount: 1 }),
          page({ pageType: "blog", imageCount: 1, formCount: 0 }),
          page({ pageType: "product", imageCount: 5, formCount: 1 }),
        ],
      })
    );
    expect(report.blogsFound).toBe(2);
    expect(report.imagesFound).toBe(9);
    expect(report.formsFound).toBe(2);
  });

  it("tallies languages across pages", () => {
    const report = generateCrawlReport(
      baseInput({ pageOutcomes: [page({ language: "English" }), page({ language: "English" }), page({ language: "Hindi" })] })
    );
    expect(report.languages).toEqual({ English: 2, Hindi: 1 });
  });

  it("computes SEO summary gaps", () => {
    const report = generateCrawlReport(
      baseInput({
        pageOutcomes: [
          page({ hasMetaTitle: false, hasMetaDescription: false, hasH1: true, imagesMissingAlt: 2 }),
          page({ hasMetaTitle: true, hasMetaDescription: true, hasH1: false, imagesMissingAlt: 1 }),
        ],
      })
    );
    expect(report.seoSummary).toEqual({
      pagesMissingMetaTitle: 1,
      pagesMissingMetaDescription: 1,
      pagesMissingH1: 1,
      imagesMissingAlt: 3,
    });
  });

  it("computes average load time and ranks slowest pages", () => {
    const report = generateCrawlReport(
      baseInput({
        pageOutcomes: [page({ url: "/a", loadTimeMs: 100 }), page({ url: "/b", loadTimeMs: 500 }), page({ url: "/c", loadTimeMs: 300 })],
      })
    );
    expect(report.performanceSummary.averageLoadTimeMs).toBe(300);
    expect(report.performanceSummary.slowestPages[0]).toEqual({ url: "/b", loadTimeMs: 500 });
  });

  it("warns when robots.txt is missing", () => {
    const report = generateCrawlReport(baseInput({ robotsTxtFound: false }));
    expect(report.warnings.some((w) => w.includes("robots.txt"))).toBe(true);
  });

  it("warns about excluded duplicates with a breakdown", () => {
    const report = generateCrawlReport(baseInput({ duplicatesSkipped: { paragraph: 12, image: 3 } }));
    expect(report.warnings.some((w) => w.includes("15 duplicate"))).toBe(true);
  });

  it("warns about pages skipped as unchanged since the last crawl", () => {
    const report = generateCrawlReport(baseInput({ unchangedPageCount: 7 }));
    expect(report.warnings.some((w) => w.includes("7 page(s) unchanged"))).toBe(true);
  });

  it("surfaces failed URLs as report errors", () => {
    const report = generateCrawlReport(baseInput({ failedUrls: [{ url: "/broken", error: "HTTP 500" }] }));
    expect(report.failedPages).toBe(1);
    expect(report.errors).toEqual([{ url: "/broken", error: "HTTP 500" }]);
  });

  it("flags pages with forms as a security observation", () => {
    const report = generateCrawlReport(baseInput({ pageOutcomes: [page({ formCount: 1 })] }));
    expect(report.securityObservations.some((s) => s.includes("form"))).toBe(true);
  });
});
