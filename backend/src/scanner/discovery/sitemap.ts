import zlib from "node:zlib";
import { XMLParser } from "fast-xml-parser";
import { safeFetch } from "../http/safeFetch";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";

const MAX_SITEMAPS_TO_FOLLOW = 20;
const MAX_URLS = 20_000;

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function fetchSitemapBody(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 10000, maxBytes: 20 * 1024 * 1024 });
    if (!res.ok) return null;
    if (url.endsWith(".gz") || res.headers["content-type"]?.toString().includes("gzip")) {
      return zlib.gunzipSync(res.body).toString("utf-8");
    }
    return res.body.toString("utf-8");
  } catch (err) {
    logEvent({ component: "scanner-discovery", message: `Sitemap fetch failed: ${url}`, status: "warn", error: formatError(err) });
    return null;
  }
}

/**
 * Recursively resolves a sitemap URL — following <sitemapindex> children,
 * flattening <urlset> entries — into a bounded, deduplicated list of page
 * URLs. Bounded on both sitemap-file count and total URL count so a
 * pathological or malicious sitemap chain can't turn discovery into an
 * unbounded crawl of its own.
 */
export async function resolveSitemapUrls(sitemapUrl: string): Promise<string[]> {
  const seenSitemaps = new Set<string>();
  const collectedUrls = new Set<string>();
  const queue = [sitemapUrl];

  while (queue.length > 0 && seenSitemaps.size < MAX_SITEMAPS_TO_FOLLOW && collectedUrls.size < MAX_URLS) {
    const current = queue.shift();
    if (!current || seenSitemaps.has(current)) continue;
    seenSitemaps.add(current);

    const body = await fetchSitemapBody(current);
    if (!body) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = xmlParser.parse(body);
    } catch {
      continue;
    }

    const sitemapIndex = parsed.sitemapindex as { sitemap?: unknown } | undefined;
    if (sitemapIndex?.sitemap) {
      for (const entry of toArray(sitemapIndex.sitemap as { loc?: string } | { loc?: string }[])) {
        if (entry?.loc) queue.push(entry.loc);
      }
      continue;
    }

    const urlset = parsed.urlset as { url?: unknown } | undefined;
    if (urlset?.url) {
      for (const entry of toArray(urlset.url as { loc?: string } | { loc?: string }[])) {
        if (entry?.loc && collectedUrls.size < MAX_URLS) collectedUrls.add(entry.loc);
      }
    }
  }

  logEvent({ component: "scanner-discovery", message: `Resolved ${collectedUrls.size} URLs from ${seenSitemaps.size} sitemap file(s)`, status: "success" });
  return [...collectedUrls];
}

/** Tries the conventional /sitemap.xml location, falling back to robots.txt-declared sitemaps if given. */
export async function discoverSitemapUrls(baseUrl: string, robotsSitemaps: string[]): Promise<string[]> {
  const candidates = robotsSitemaps.length > 0 ? robotsSitemaps : [new URL("/sitemap.xml", baseUrl).toString()];
  const all = new Set<string>();
  for (const candidate of candidates) {
    for (const url of await resolveSitemapUrls(candidate)) all.add(url);
  }
  return [...all];
}
