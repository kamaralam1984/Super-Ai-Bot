import { formatError } from "../../utils/formatError";

export interface CrawlQueueOptions {
  maxDepth: number;
  maxPages: number;
  concurrency: number;
  maxRetries: number;
  retryDelayMs: number;
}

export interface CrawlTaskResult {
  discoveredUrls: string[];
}

export type CrawlTaskHandler = (url: string, depth: number) => Promise<CrawlTaskResult>;

export interface CrawlQueueProgress {
  processed: number;
  succeeded: number;
  failed: number;
  queued: number;
}

export interface CrawlQueueSummary {
  visitedUrls: string[];
  failedUrls: { url: string; error: string }[];
  skippedUrls: { url: string; reason: string }[];
}

/**
 * Bounded-concurrency BFS crawl over a seed set. Each successful task can
 * discover more URLs (from links found on that page), which get queued at
 * depth+1 — subject to maxDepth, maxPages, and robots.txt `isAllowed`.
 * Politeness (per-host rate limiting, Crawl-delay) is the *handler's*
 * responsibility via PerHostRateLimiter — this queue only manages
 * traversal order, concurrency, retries, and the hard caps.
 */
export async function runCrawlQueue(
  seedUrls: string[],
  handler: CrawlTaskHandler,
  isAllowed: (url: string) => boolean,
  options: CrawlQueueOptions,
  onProgress?: (progress: CrawlQueueProgress) => void
): Promise<CrawlQueueSummary> {
  const visited = new Set<string>();
  const failedUrls: { url: string; error: string }[] = [];
  const skippedUrls: { url: string; reason: string }[] = [];
  const queue: { url: string; depth: number }[] = [];
  const queuedSet = new Set<string>();

  for (const url of seedUrls) {
    if (!queuedSet.has(url)) {
      queue.push({ url, depth: 0 });
      queuedSet.add(url);
    }
  }

  if (seedUrls.length === 0) {
    return { visitedUrls: [], failedUrls: [], skippedUrls: [] };
  }

  let active = 0;
  let processedCount = 0;

  return new Promise((resolve) => {
    const reportProgress = () => {
      onProgress?.({ processed: processedCount, succeeded: visited.size, failed: failedUrls.length, queued: queue.length });
    };

    const tryFinish = (): boolean => {
      const exhausted = queue.length === 0 || visited.size >= options.maxPages;
      if (active === 0 && exhausted) {
        resolve({ visitedUrls: [...visited], failedUrls, skippedUrls });
        return true;
      }
      return false;
    };

    const processOne = async (task: { url: string; depth: number }) => {
      active++;
      let attempt = 0;
      let lastError: string | null = null;
      let success = false;

      while (attempt <= options.maxRetries && !success) {
        try {
          const result = await handler(task.url, task.depth);
          visited.add(task.url);
          success = true;

          if (task.depth < options.maxDepth) {
            for (const discovered of result.discoveredUrls) {
              if (visited.size + queue.length >= options.maxPages) break;
              if (visited.has(discovered) || queuedSet.has(discovered)) continue;
              if (!isAllowed(discovered)) {
                skippedUrls.push({ url: discovered, reason: "disallowed by robots.txt" });
                continue;
              }
              queue.push({ url: discovered, depth: task.depth + 1 });
              queuedSet.add(discovered);
            }
          }
        } catch (err) {
          lastError = formatError(err);
          attempt++;
          if (attempt <= options.maxRetries) {
            await new Promise((r) => setTimeout(r, options.retryDelayMs * attempt));
          }
        }
      }

      if (!success && lastError) {
        failedUrls.push({ url: task.url, error: lastError });
      }

      processedCount++;
      active--;
      reportProgress();

      if (!tryFinish()) pump();
    };

    const pump = () => {
      while (active < options.concurrency && queue.length > 0 && visited.size + active < options.maxPages) {
        const task = queue.shift();
        if (!task) break;
        void processOne(task);
      }
      tryFinish();
    };

    pump();
  });
}
