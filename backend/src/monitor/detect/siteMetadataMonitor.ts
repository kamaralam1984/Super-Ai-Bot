// Site Metadata Monitor — change detection for the things a site publishes
// that aren't "a page" in the crawled-content sense: its sitemap.xml URL
// list, its robots.txt rules, and its detected technology stack (Phase
// 4's TechDetectionReport). Pure comparison functions; the caller
// (monitorOrchestrator.service.ts) supplies both snapshots already read.

export interface SitemapChangeResult {
  changed: boolean;
  urlsAdded: number;
  urlsRemoved: number;
  addedUrls: string[];
  removedUrls: string[];
}

const MAX_LISTED_URLS = 25;

export function detectSitemapChanges(oldUrls: string[], newUrls: string[]): SitemapChangeResult {
  const oldSet = new Set(oldUrls);
  const newSet = new Set(newUrls);
  const added = newUrls.filter((u) => !oldSet.has(u));
  const removed = oldUrls.filter((u) => !newSet.has(u));
  return { changed: added.length > 0 || removed.length > 0, urlsAdded: added.length, urlsRemoved: removed.length, addedUrls: added.slice(0, MAX_LISTED_URLS), removedUrls: removed.slice(0, MAX_LISTED_URLS) };
}

export interface RobotsTxtChangeResult {
  changed: boolean;
}

function normalizeRobotsTxt(content: string | null): string {
  return (content ?? "").trim().replace(/\r\n/g, "\n");
}

/** Byte-content comparison (after trivial line-ending/whitespace normalization) — robots.txt has no semantic structure worth parsing here; any real edit (a new Disallow rule, a changed crawl-delay) is exactly the kind of change an administrator should be told about, and a false positive from formatting noise is harmless (it just means one extra notification, not an incorrect one). */
export function detectRobotsTxtChange(oldContent: string | null, newContent: string | null): RobotsTxtChangeResult {
  return { changed: normalizeRobotsTxt(oldContent) !== normalizeRobotsTxt(newContent) };
}

export interface TechnologyChangeResult {
  changed: boolean;
  addedTechnologies: string[];
  removedTechnologies: string[];
}

/** Compares the flattened set of detected technology names (top candidate per category, e.g. from Phase 4's TechDetectionReport) between two scans — a platform migration (WordPress → a custom Next.js site) is exactly the kind of change that could silently break every connector/endpoint assumption downstream, worth its own notification type. */
export function detectTechnologyChanges(oldTechnologies: string[], newTechnologies: string[]): TechnologyChangeResult {
  const oldSet = new Set(oldTechnologies);
  const newSet = new Set(newTechnologies);
  const added = newTechnologies.filter((t) => !oldSet.has(t));
  const removed = oldTechnologies.filter((t) => !newSet.has(t));
  return { changed: added.length > 0 || removed.length > 0, addedTechnologies: added, removedTechnologies: removed };
}
