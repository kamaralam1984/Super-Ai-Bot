import { describe, it, expect } from "vitest";
import { buildComparisonReport, summarizeComparisonHighlights } from "./comparisonReportBuilder";
import type { ComparisonReportInput, KnowledgeComparisonReportData } from "./comparisonReportBuilder";
import type { EntityChangeSummary } from "../detect/entityChangeDetector";

function baseInput(overrides: Partial<ComparisonReportInput> = {}): ComparisonReportInput {
  return {
    crawlJobId: "job-2",
    previousCrawlJobId: "job-1",
    pageChanges: { totalPrevious: 10, totalCurrent: 10, newCount: 0, modifiedCount: 0, unchangedCount: 10, deletedCount: 0, changeRatio: 0 },
    chunkChanges: { chunksAdded: 0, chunksUpdated: 0, chunksRemoved: 0, chunksDuplicate: 0 },
    entityChanges: [],
    sitemapChange: { changed: false, urlsAdded: 0, urlsRemoved: 0, addedUrls: [], removedUrls: [] },
    robotsTxtChange: { changed: false },
    technologyChange: { changed: false, addedTechnologies: [], removedTechnologies: [] },
    ...overrides,
  };
}

describe("buildComparisonReport", () => {
  it("maps page-level changes through", () => {
    const report = buildComparisonReport(baseInput({ pageChanges: { totalPrevious: 10, totalCurrent: 12, newCount: 3, modifiedCount: 2, unchangedCount: 7, deletedCount: 1, changeRatio: 0.5 } }));
    expect(report).toMatchObject({ pagesAdded: 3, pagesUpdated: 2, pagesUnchanged: 7, pagesRemoved: 1 });
  });

  it("maps chunk-level changes through", () => {
    const report = buildComparisonReport(baseInput({ chunkChanges: { chunksAdded: 5, chunksUpdated: 2, chunksRemoved: 1, chunksDuplicate: 3 } }));
    expect(report).toMatchObject({ chunksAdded: 5, chunksUpdated: 2, chunksRemoved: 1, chunksDuplicate: 3 });
  });

  it("builds a categoryBreakdown keyed by entity category", () => {
    const entityChanges: EntityChangeSummary[] = [
      { category: "products", added: 2, removed: 0, updated: 1, changes: [], truncated: false },
      { category: "faqs", added: 0, removed: 1, updated: 0, changes: [], truncated: false },
    ];
    const report = buildComparisonReport(baseInput({ entityChanges }));
    expect(report.categoryBreakdown).toEqual({ products: { added: 2, removed: 0, updated: 1 }, faqs: { added: 0, removed: 1, updated: 0 } });
  });

  it("preserves the full entityChanges array, not just the breakdown counts", () => {
    const entityChanges: EntityChangeSummary[] = [{ category: "products", added: 1, removed: 0, updated: 0, changes: [{ identity: "Widget", changeType: "added", fieldChanges: [] }], truncated: false }];
    const report = buildComparisonReport(baseInput({ entityChanges }));
    expect(report.entityChanges).toBe(entityChanges);
  });

  it("maps metadata changes through", () => {
    const report = buildComparisonReport(
      baseInput({
        sitemapChange: { changed: true, urlsAdded: 2, urlsRemoved: 1, addedUrls: ["a", "b"], removedUrls: ["c"] },
        robotsTxtChange: { changed: true },
        technologyChange: { changed: true, addedTechnologies: ["Next.js"], removedTechnologies: ["WordPress"] },
      })
    );
    expect(report.metadataChanges).toEqual({
      sitemapChanged: true,
      sitemapUrlsAdded: 2,
      sitemapUrlsRemoved: 1,
      robotsTxtChanged: true,
      technologyChanged: true,
      addedTechnologies: ["Next.js"],
      removedTechnologies: ["WordPress"],
    });
  });

  it("carries crawlJobId/previousCrawlJobId through, including a null previous (first-ever run)", () => {
    const report = buildComparisonReport(baseInput({ previousCrawlJobId: null }));
    expect(report.crawlJobId).toBe("job-2");
    expect(report.previousCrawlJobId).toBeNull();
  });
});

describe("summarizeComparisonHighlights", () => {
  function report(overrides: Partial<KnowledgeComparisonReportData> = {}): KnowledgeComparisonReportData {
    return {
      crawlJobId: "job-2",
      previousCrawlJobId: "job-1",
      pagesAdded: 0,
      pagesRemoved: 0,
      pagesUpdated: 0,
      pagesUnchanged: 10,
      chunksAdded: 0,
      chunksRemoved: 0,
      chunksUpdated: 0,
      chunksDuplicate: 0,
      entityChanges: [],
      metadataChanges: { sitemapChanged: false, sitemapUrlsAdded: 0, sitemapUrlsRemoved: 0, robotsTxtChanged: false, technologyChanged: false, addedTechnologies: [], removedTechnologies: [] },
      categoryBreakdown: {},
      generatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("reports 'no meaningful changes' when nothing changed", () => {
    const highlights = summarizeComparisonHighlights(report());
    expect(highlights).toEqual([{ message: "No meaningful changes detected since the last scan.", severity: "info" }]);
  });

  it("highlights new products", () => {
    const highlights = summarizeComparisonHighlights(report({ entityChanges: [{ category: "products", added: 3, removed: 0, updated: 0, changes: [], truncated: false }] }));
    expect(highlights).toContainEqual({ message: "3 new products found.", severity: "info" });
  });

  it("uses singular phrasing for a count of one", () => {
    const highlights = summarizeComparisonHighlights(report({ entityChanges: [{ category: "services", added: 1, removed: 0, updated: 0, changes: [], truncated: false }] }));
    expect(highlights).toContainEqual({ message: "1 new service found.", severity: "info" });
  });

  it("highlights significant price changes with warning severity", () => {
    const highlights = summarizeComparisonHighlights(
      report({
        entityChanges: [
          {
            category: "products",
            added: 0,
            removed: 0,
            updated: 1,
            changes: [{ identity: "Widget", changeType: "updated", fieldChanges: [{ field: "price", oldValue: "10", newValue: "12", significant: true }] }],
            truncated: false,
          },
        ],
      })
    );
    expect(highlights).toContainEqual({ message: "1 product price change detected.", severity: "warning" });
  });

  it("does not flag a non-significant field change as a price change", () => {
    const highlights = summarizeComparisonHighlights(
      report({
        entityChanges: [
          { category: "products", added: 0, removed: 0, updated: 1, changes: [{ identity: "Widget", changeType: "updated", fieldChanges: [{ field: "description", oldValue: "a", newValue: "b", significant: false }] }], truncated: false },
        ],
      })
    );
    expect(highlights.some((h) => h.message.includes("price change"))).toBe(false);
  });

  it("highlights a technology stack change", () => {
    const highlights = summarizeComparisonHighlights(report({ metadataChanges: { sitemapChanged: false, sitemapUrlsAdded: 0, sitemapUrlsRemoved: 0, robotsTxtChanged: false, technologyChanged: true, addedTechnologies: ["Next.js"], removedTechnologies: ["WordPress"] } }));
    expect(highlights).toContainEqual({ message: "Technology stack changed — added: Next.js; removed: WordPress.", severity: "warning" });
  });

  it("highlights removed pages", () => {
    const highlights = summarizeComparisonHighlights(report({ pagesRemoved: 2 }));
    expect(highlights).toContainEqual({ message: "2 pages removed from the site.", severity: "info" });
  });

  it("does not report 'no meaningful changes' when something did change", () => {
    const highlights = summarizeComparisonHighlights(report({ pagesAdded: 1 }));
    expect(highlights.some((h) => h.message.includes("No meaningful changes"))).toBe(false);
  });
});
