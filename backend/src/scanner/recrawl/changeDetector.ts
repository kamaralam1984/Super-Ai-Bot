export interface PreviousPageRecord {
  url: string;
  contentHash: string | null;
}

export interface CurrentPageRecord {
  url: string;
  contentHash: string;
}

export interface RecrawlPlan {
  newUrls: string[];
  modifiedUrls: string[];
  unchangedUrls: string[];
  deletedUrls: string[];
}

/**
 * Compares the previous crawl's page records against the current crawl's
 * pages (by URL + content hash) to classify every page as new, modified,
 * unchanged, or deleted. This is the decision layer for "partial
 * recrawling" — the orchestrator (Task 31) skips the expensive steps
 * (dedup, chunking, embedding) for `unchangedUrls` and only reprocesses
 * `newUrls`/`modifiedUrls`, and removes knowledge tied to `deletedUrls`.
 */
export function planIncrementalRecrawl(previousPages: PreviousPageRecord[], currentPages: CurrentPageRecord[]): RecrawlPlan {
  const previousHashByUrl = new Map(previousPages.map((p) => [p.url, p.contentHash]));
  const currentUrls = new Set(currentPages.map((p) => p.url));

  const newUrls: string[] = [];
  const modifiedUrls: string[] = [];
  const unchangedUrls: string[] = [];

  for (const page of currentPages) {
    if (!previousHashByUrl.has(page.url)) {
      newUrls.push(page.url);
    } else if (previousHashByUrl.get(page.url) !== page.contentHash) {
      modifiedUrls.push(page.url);
    } else {
      unchangedUrls.push(page.url);
    }
  }

  const deletedUrls = previousPages.filter((p) => !currentUrls.has(p.url)).map((p) => p.url);

  return { newUrls, modifiedUrls, unchangedUrls, deletedUrls };
}

export interface RecrawlSummary {
  totalPrevious: number;
  totalCurrent: number;
  newCount: number;
  modifiedCount: number;
  unchangedCount: number;
  deletedCount: number;
  changeRatio: number;
}

export function summarizePlan(plan: RecrawlPlan, previousCount: number, currentCount: number): RecrawlSummary {
  const changed = plan.newUrls.length + plan.modifiedUrls.length + plan.deletedUrls.length;
  const total = Math.max(previousCount, currentCount, 1);
  return {
    totalPrevious: previousCount,
    totalCurrent: currentCount,
    newCount: plan.newUrls.length,
    modifiedCount: plan.modifiedUrls.length,
    unchangedCount: plan.unchangedUrls.length,
    deletedCount: plan.deletedUrls.length,
    changeRatio: changed / total,
  };
}
