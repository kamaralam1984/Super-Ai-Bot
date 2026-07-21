// Knowledge Comparison Engine — assembles the persisted, structured
// old-vs-new diff report from everything the training run's other engines
// already computed: Phase 2's page-level RecrawlSummary
// (scanner/recrawl/changeDetector.ts), Phase 3's chunk-level
// KnowledgeBuildResult, and this phase's own entity-level
// EntityChangeSummary[] plus site-metadata change results. Pure assembly
// — no new computation, no I/O. Persistence is monitorRecord.service.ts's
// job; this module's only responsibility is turning five already-decided
// pieces into one coherent, reportable shape.

import type { RecrawlSummary } from "../../scanner/recrawl/changeDetector";
import type { EntityChangeSummary } from "../detect/entityChangeDetector";
import type { RobotsTxtChangeResult, SitemapChangeResult, TechnologyChangeResult } from "../detect/siteMetadataMonitor";

export interface ChunkChangeStats {
  chunksAdded: number;
  chunksUpdated: number;
  chunksRemoved: number;
  chunksDuplicate: number;
}

export interface ComparisonReportInput {
  crawlJobId: string;
  previousCrawlJobId: string | null;
  pageChanges: RecrawlSummary;
  chunkChanges: ChunkChangeStats;
  entityChanges: EntityChangeSummary[];
  sitemapChange: SitemapChangeResult;
  robotsTxtChange: RobotsTxtChangeResult;
  technologyChange: TechnologyChangeResult;
}

export interface MetadataChangeSummary {
  sitemapChanged: boolean;
  sitemapUrlsAdded: number;
  sitemapUrlsRemoved: number;
  robotsTxtChanged: boolean;
  technologyChanged: boolean;
  addedTechnologies: string[];
  removedTechnologies: string[];
}

export interface CategoryBreakdownEntry {
  added: number;
  removed: number;
  updated: number;
}

export interface KnowledgeComparisonReportData {
  crawlJobId: string;
  previousCrawlJobId: string | null;
  pagesAdded: number;
  pagesRemoved: number;
  pagesUpdated: number;
  pagesUnchanged: number;
  chunksAdded: number;
  chunksRemoved: number;
  chunksUpdated: number;
  chunksDuplicate: number;
  entityChanges: EntityChangeSummary[];
  metadataChanges: MetadataChangeSummary;
  categoryBreakdown: Record<string, CategoryBreakdownEntry>;
  generatedAt: string;
}

export function buildComparisonReport(input: ComparisonReportInput): KnowledgeComparisonReportData {
  const categoryBreakdown: Record<string, CategoryBreakdownEntry> = {};
  for (const summary of input.entityChanges) {
    categoryBreakdown[summary.category] = { added: summary.added, removed: summary.removed, updated: summary.updated };
  }

  return {
    crawlJobId: input.crawlJobId,
    previousCrawlJobId: input.previousCrawlJobId,
    pagesAdded: input.pageChanges.newCount,
    pagesRemoved: input.pageChanges.deletedCount,
    pagesUpdated: input.pageChanges.modifiedCount,
    pagesUnchanged: input.pageChanges.unchangedCount,
    chunksAdded: input.chunkChanges.chunksAdded,
    chunksRemoved: input.chunkChanges.chunksRemoved,
    chunksUpdated: input.chunkChanges.chunksUpdated,
    chunksDuplicate: input.chunkChanges.chunksDuplicate,
    entityChanges: input.entityChanges,
    metadataChanges: {
      sitemapChanged: input.sitemapChange.changed,
      sitemapUrlsAdded: input.sitemapChange.urlsAdded,
      sitemapUrlsRemoved: input.sitemapChange.urlsRemoved,
      robotsTxtChanged: input.robotsTxtChange.changed,
      technologyChanged: input.technologyChange.changed,
      addedTechnologies: input.technologyChange.addedTechnologies,
      removedTechnologies: input.technologyChange.removedTechnologies,
    },
    categoryBreakdown,
    generatedAt: new Date().toISOString(),
  };
}

export interface ComparisonHighlight {
  message: string;
  severity: "info" | "warning";
}

/** Derives a small set of human-readable highlights from a report — what a human actually wants to read at a glance, not raw counts. The Notification Engine uses this to compose a message body for "Website Updated"/"Knowledge Updated" notifications. */
export function summarizeComparisonHighlights(report: KnowledgeComparisonReportData): ComparisonHighlight[] {
  const highlights: ComparisonHighlight[] = [];

  const productChanges = report.entityChanges.find((c) => c.category === "products");
  if (productChanges && productChanges.added > 0) {
    highlights.push({ message: `${productChanges.added} new product${productChanges.added === 1 ? "" : "s"} found.`, severity: "info" });
  }
  const serviceChanges = report.entityChanges.find((c) => c.category === "services");
  if (serviceChanges && serviceChanges.added > 0) {
    highlights.push({ message: `${serviceChanges.added} new service${serviceChanges.added === 1 ? "" : "s"} found.`, severity: "info" });
  }

  const priceChangeCount = (productChanges?.changes ?? []).filter((c) => c.fieldChanges.some((f) => f.field === "price" && f.significant)).length;
  if (priceChangeCount > 0) {
    highlights.push({ message: `${priceChangeCount} product price change${priceChangeCount === 1 ? "" : "s"} detected.`, severity: "warning" });
  }

  if (report.metadataChanges.technologyChanged) {
    const added = report.metadataChanges.addedTechnologies.join(", ") || "none";
    const removed = report.metadataChanges.removedTechnologies.join(", ") || "none";
    highlights.push({ message: `Technology stack changed — added: ${added}; removed: ${removed}.`, severity: "warning" });
  }

  if (report.pagesRemoved > 0) {
    highlights.push({ message: `${report.pagesRemoved} page${report.pagesRemoved === 1 ? "" : "s"} removed from the site.`, severity: "info" });
  }

  const totalEntityChurn = report.entityChanges.reduce((sum, c) => sum + c.added + c.removed + c.updated, 0);
  const nothingChanged = totalEntityChurn === 0 && report.pagesAdded === 0 && report.pagesUpdated === 0 && report.pagesRemoved === 0;
  if (nothingChanged) {
    highlights.push({ message: "No meaningful changes detected since the last scan.", severity: "info" });
  }

  return highlights;
}
