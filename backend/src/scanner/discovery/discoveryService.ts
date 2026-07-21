import * as cheerio from "cheerio";
import { safeFetchText } from "../http/safeFetch";
import { fetchRobotsTxt } from "./robotsTxt";
import { discoverSitemapUrls } from "./sitemap";
import { discoverDeclaredFeeds } from "./rssFeed";
import { classifyLink, normalizeUrl } from "./linkClassifier";
import { detectTechStack } from "./techStack";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";
import type { ClassifiedLink, DiscoveryResult } from "../types";

function extractAllLinks(html: string, baseUrl: string): ClassifiedLink[] {
  const $ = cheerio.load(html);
  const links = new Map<string, ClassifiedLink>();

  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
    try {
      const absolute = normalizeUrl(new URL(href, baseUrl).toString());
      if (!links.has(absolute)) {
        links.set(absolute, { url: absolute, category: classifyLink(absolute, baseUrl) });
      }
    } catch {
      // malformed href — skip
    }
  });

  return [...links.values()];
}

/**
 * Step 1 of the scan pipeline: figure out what to crawl before crawling
 * anything. Combines robots.txt, sitemap.xml (recursively resolved),
 * homepage nav/footer link discovery, and tech-stack signals into a single
 * seed list the crawl queue (Task 23) consumes.
 */
export async function discoverWebsite(inputUrl: string): Promise<DiscoveryResult> {
  const baseUrl = new URL(inputUrl).origin;
  const warnings: string[] = [];

  const robots = await fetchRobotsTxt(baseUrl);
  const robotsTxtFound = robots.found;
  const robotsTxtContent = robots.rawContent;

  const homepageResult = await safeFetchText(inputUrl, { timeoutMs: 15000 }).catch((err) => {
    warnings.push(`Could not fetch homepage: ${formatError(err)}`);
    return null;
  });

  if (!homepageResult) {
    return { baseUrl, robotsTxtFound, robotsTxtContent, sitemapUrls: [], rssFeedUrls: [], homepageLinks: [], seedUrls: [], techStack: { cms: null, frameworks: [], server: null, ecommerce: null, confidence: "low" }, warnings };
  }

  const { text: homepageHtml, result: homepageResponse } = homepageResult;

  const [sitemapUrls, techStack] = await Promise.all([
    discoverSitemapUrls(baseUrl, robots.sitemapUrls).catch((err) => {
      warnings.push(`Sitemap discovery failed: ${formatError(err)}`);
      return [] as string[];
    }),
    Promise.resolve(detectTechStack(homepageHtml, homepageResponse.headers)),
  ]);

  const homepageLinks = extractAllLinks(homepageHtml, baseUrl);
  const rssFeedUrls = discoverDeclaredFeeds(homepageHtml, baseUrl);

  const internalFromLinks = homepageLinks.filter((l) => l.category === "internal").map((l) => l.url);
  const seedUrls = [...new Set([normalizeUrl(inputUrl), ...sitemapUrls, ...internalFromLinks])];

  logEvent({
    component: "scanner-discovery",
    message: `Discovery complete for ${baseUrl}: ${seedUrls.length} seed URLs, tech stack: ${techStack.cms ?? "unknown CMS"} / ${techStack.frameworks.join(", ") || "no framework signals"}`,
    status: "success",
  });

  return { baseUrl, robotsTxtFound, robotsTxtContent, sitemapUrls, rssFeedUrls, homepageLinks, seedUrls, techStack, warnings };
}

export { extractAllLinks };
