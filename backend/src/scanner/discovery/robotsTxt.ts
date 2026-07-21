import robotsParser, { type Robot } from "robots-parser";
import { safeFetchText } from "../http/safeFetch";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";

const SCANNER_USER_AGENT = "KVL-Super-AI-Chatbot-Scanner";

export interface RobotsInfo {
  found: boolean;
  isAllowed: (url: string) => boolean;
  crawlDelayMs: number | null;
  sitemapUrls: string[];
  /** Raw fetched body, kept for monitor/detect/siteMetadataMonitor.ts's byte-level diff against the next crawl's robots.txt — null when not found/unreachable. */
  rawContent: string | null;
}

/**
 * Fetches and parses robots.txt for the given site. If it's missing or
 * unreachable, everything is treated as allowed (the standard, spec-defined
 * behavior — absence of robots.txt is not a disallow) but we still log it
 * so a crawl report can note "no robots.txt found" as an observation.
 */
export async function fetchRobotsTxt(baseUrl: string): Promise<RobotsInfo> {
  const robotsUrl = new URL("/robots.txt", baseUrl).toString();

  try {
    const { text, result } = await safeFetchText(robotsUrl, { timeoutMs: 8000, maxBytes: 512 * 1024 });
    if (!result.ok) {
      logEvent({ component: "scanner-discovery", message: `No robots.txt at ${robotsUrl} (HTTP ${result.statusCode}) — treating everything as allowed`, status: "info" });
      return { found: false, isAllowed: () => true, crawlDelayMs: null, sitemapUrls: [], rawContent: null };
    }

    const robot: Robot = robotsParser(robotsUrl, text);
    const crawlDelaySec = robot.getCrawlDelay(SCANNER_USER_AGENT) ?? robot.getCrawlDelay("*");

    return {
      found: true,
      isAllowed: (url: string) => robot.isAllowed(url, SCANNER_USER_AGENT) ?? true,
      crawlDelayMs: crawlDelaySec ? crawlDelaySec * 1000 : null,
      sitemapUrls: robot.getSitemaps(),
      rawContent: text,
    };
  } catch (err) {
    logEvent({ component: "scanner-discovery", message: `robots.txt fetch failed for ${robotsUrl}`, status: "warn", error: formatError(err) });
    return { found: false, isAllowed: () => true, crawlDelayMs: null, sitemapUrls: [], rawContent: null };
  }
}
