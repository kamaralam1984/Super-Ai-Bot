import dns from "node:dns/promises";
import zlib from "node:zlib";
import * as cheerio from "cheerio";
import { safeFetch } from "../../scanner/http/safeFetch";
import { fetchRobotsTxt } from "../../scanner/discovery/robotsTxt";
import { discoverSitemapUrls } from "../../scanner/discovery/sitemap";
import { extractStructuredData } from "../../scanner/parse/structuredData";
import { probeTls } from "../../utils/tlsProbe";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";
import type { SiteSignals, ParsedScriptTag, ParsedMetaTag, ParsedLinkTag, ParsedFormTag, WellKnownProbe } from "../types";

/**
 * Small, fixed set of public, read-only paths whose presence/absence is a
 * strong technology signal — the same category of check any passive
 * technology-profiling tool (Wappalyzer, BuiltWith) performs. Every path
 * is a plain GET against a page the site itself serves publicly; none of
 * these bypass authentication or access anything not already exposed to
 * an ordinary visitor's browser.
 */
const WELL_KNOWN_PATHS = [
  "/wp-login.php",
  "/wp-json/",
  "/xmlrpc.php",
  "/readme.html",
  "/administrator/",
  "/user/login",
  "/cdn-cgi/trace",
  "/products.json",
  "/.well-known/security.txt",
  "/.well-known/change-password",
  "/manifest.json",
  "/feed/",
  "/sitemap.xml",
  "/robots.txt",
] as const;

const HOMEPAGE_TIMEOUT_MS = 12_000;
const HOMEPAGE_MAX_BYTES = 5 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 6_000;
const PROBE_MAX_BYTES = 64 * 1024;

/** Decodes a response body according to its Content-Encoding — undici does not do this automatically (verified: with Accept-Encoding requested, `response.body` contains raw compressed bytes, not decoded text). Falls back to plain UTF-8 decoding for an unrecognized/missing encoding or a body that fails to decompress (some servers send a Content-Encoding header without actually compressing, or the encoding is a value like "identity"). */
function decodeResponseBody(body: Buffer, contentEncoding: string | string[] | undefined): string {
  const encoding = (Array.isArray(contentEncoding) ? contentEncoding[0] : contentEncoding)?.toLowerCase().trim();
  try {
    if (encoding === "br") return zlib.brotliDecompressSync(body).toString("utf-8");
    if (encoding === "gzip") return zlib.gunzipSync(body).toString("utf-8");
    if (encoding === "deflate") return zlib.inflateSync(body).toString("utf-8");
  } catch {
    // fall through to plain decoding below
  }
  return body.toString("utf-8");
}

function parseScripts($: cheerio.CheerioAPI): ParsedScriptTag[] {
  return $("script")
    .toArray()
    .map((el) => {
      const src = $(el).attr("src");
      if (src) return { src, inline: null };
      const body = $(el).html()?.trim();
      return { src: null, inline: body && body.length > 0 ? body : null };
    })
    .filter((s) => s.src !== null || s.inline !== null);
}

function parseMetaTags($: cheerio.CheerioAPI): ParsedMetaTag[] {
  return $("meta")
    .toArray()
    .map((el) => ({
      name: $(el).attr("name") ?? null,
      property: $(el).attr("property") ?? null,
      content: $(el).attr("content") ?? "",
    }))
    .filter((m) => m.name !== null || m.property !== null);
}

function parseLinkTags($: cheerio.CheerioAPI): ParsedLinkTag[] {
  return $("link")
    .toArray()
    .map((el) => ({
      rel: $(el).attr("rel") ?? null,
      href: $(el).attr("href") ?? "",
      as: $(el).attr("as") ?? null,
    }))
    .filter((l) => l.href.length > 0);
}

function parseForms($: cheerio.CheerioAPI): ParsedFormTag[] {
  return $("form")
    .toArray()
    .map((form) => ({
      action: $(form).attr("action") ?? null,
      method: ($(form).attr("method") ?? "get").toLowerCase(),
      id: $(form).attr("id") ?? null,
      className: $(form).attr("class") ?? null,
      fields: $(form)
        .find("input, textarea, select")
        .toArray()
        .map((field) => ({
          name: $(field).attr("name") ?? null,
          type: ($(field).attr("type") ?? $(field).prop("tagName") ?? "text").toString().toLowerCase(),
          placeholder: $(field).attr("placeholder") ?? null,
        })),
    }));
}

function parseHtmlAttributes($: cheerio.CheerioAPI): Record<string, string> {
  const attrs: Record<string, string> = {};
  const htmlEl = $("html").get(0);
  if (htmlEl && "attribs" in htmlEl) {
    for (const [key, value] of Object.entries((htmlEl as { attribs: Record<string, string> }).attribs)) {
      attrs[key] = value;
    }
  }
  return attrs;
}

function parseBodyClassNames($: cheerio.CheerioAPI): string[] {
  const raw = $("body").attr("class") ?? "";
  return raw.split(/\s+/).filter(Boolean);
}

/**
 * Most real hostnames have no NS records of their own — NS records live at
 * the registrable/apex domain (or an explicit delegation point), not on
 * every subdomain. A direct `resolveNs("books.toscrape.com")` reliably
 * returns ENODATA (verified against a real site) while
 * `resolveNs("toscrape.com")` reveals real hosting (AWS Route53 in that
 * case) — so this walks up the label chain toward the apex until it finds
 * an answer. This is a heuristic, not full public-suffix-list resolution
 * (no such dependency exists in this project) — bounded to 4 hops and
 * stopping with 2 labels left, which is correct for the overwhelming
 * majority of real domains; it only under-resolves at the very top of
 * multi-part TLDs (co.uk, com.au, ...), where it legitimately finds
 * nothing rather than misattributing a wrong answer.
 */
async function resolveNameservers(hostname: string): Promise<string[]> {
  const labels = hostname.split(".");
  for (let i = 0; i < Math.min(4, labels.length - 1); i++) {
    const candidate = labels.slice(i).join(".");
    try {
      const ns = await dns.resolveNs(candidate);
      if (ns.length > 0) return ns;
    } catch {
      // ENODATA/ENOTFOUND at this level — try the next level up
    }
  }
  return [];
}

const PROBE_CONCURRENCY = 4;

/**
 * Probes run with bounded concurrency, not fully sequential (measured
 * ~14s wall-clock for 14 paths against a real site — too slow to run on
 * every scan) and not fully unbounded either: sending all 14 requests to
 * the same origin at once briefly caused a real connect-timeout failure
 * in testing, almost certainly the shared undici Agent's per-origin
 * connection pool queuing requests past its limit. A small concurrency
 * cap keeps this fast without hammering one host at once — the same
 * "politeness" tradeoff Phase 2's crawler makes explicitly with its own
 * per-host rate limiter.
 */
/**
 * A deliberately nonsensical path no real site would legitimately serve.
 * If THIS also comes back non-404, the site treats arbitrary top-level
 * paths as valid resources — verified for real against github.com, whose
 * own URL scheme resolves any single path segment as a potential
 * username/org page (`/administrator/` and `/readme.html` both returned
 * 200, producing false-positive Joomla/WordPress signals that had nothing
 * to do with either platform actually being present).
 */
const CANARY_PATH = "/__kvl_techdetect_canary_check_do_not_use__";

async function probeOnePath(origin: string, path: string, isAllowed: (url: string) => boolean): Promise<WellKnownProbe> {
  const probeUrl = `${origin}${path}`;
  if (!isAllowed(probeUrl)) {
    return { path, found: false, statusCode: null };
  }
  try {
    const response = await safeFetch(probeUrl, { timeoutMs: PROBE_TIMEOUT_MS, maxBytes: PROBE_MAX_BYTES, maxRedirects: 2 });
    return { path, found: response.statusCode < 400, statusCode: response.statusCode };
  } catch (err) {
    logEvent({ component: "techdetect-signals", message: `Well-known path probe failed: ${probeUrl}`, status: "warn", error: formatError(err) });
    return { path, found: false, statusCode: null };
  }
}

async function probeWellKnownPaths(baseUrl: string, isAllowed: (url: string) => boolean): Promise<WellKnownProbe[]> {
  const origin = new URL(baseUrl).origin;
  const results: WellKnownProbe[] = new Array(WELL_KNOWN_PATHS.length);

  for (let i = 0; i < WELL_KNOWN_PATHS.length; i += PROBE_CONCURRENCY) {
    const batch = WELL_KNOWN_PATHS.slice(i, i + PROBE_CONCURRENCY);
    const batchResults = await Promise.all(batch.map((path) => probeOnePath(origin, path, isAllowed)));
    batchResults.forEach((result, offset) => {
      results[i + offset] = result;
    });
  }

  const canary = await probeOnePath(origin, CANARY_PATH, isAllowed);
  if (canary.found) {
    logEvent({
      component: "techdetect-signals",
      message: `${origin} returns a non-404 status for a deliberately nonsensical path (${canary.statusCode}) — treating all well-known-path probes as unreliable for this site`,
      status: "warn",
    });
    return results.map((r) => ({ ...r, found: false }));
  }

  return results;
}

/**
 * Gathers every raw signal `detect/*.ts` needs, exactly once per site —
 * one homepage fetch, one robots.txt fetch, one bounded round of
 * well-known-path probes, one TLS handshake, one DNS lookup. This is the
 * only module in `techdetect/` that touches the network; every detector
 * downstream is a pure function over the `SiteSignals` this returns.
 */
export async function collectSignals(websiteUrl: string): Promise<SiteSignals> {
  // Requesting compression is what actually reveals whether the server
  // supports it — undici/Node doesn't send Accept-Encoding by default the
  // way a browser does, so an un-negotiated request always comes back
  // uncompressed even from a server that fully supports Brotli/gzip
  // (verified for real: books.toscrape.com reports no Content-Encoding
  // without this header, but "br" once it's offered). undici also does
  // NOT auto-decompress the body once a server does honor the header — a
  // second real check found `response.body` containing raw compressed
  // bytes, not decoded text — so the decompression below is required, not
  // optional, once Accept-Encoding is added to the request.
  const homepage = await safeFetch(websiteUrl, {
    timeoutMs: HOMEPAGE_TIMEOUT_MS,
    maxBytes: HOMEPAGE_MAX_BYTES,
    headers: { "Accept-Encoding": "gzip, deflate, br" },
  });
  const html = decodeResponseBody(homepage.body, homepage.headers["content-encoding"]);
  const $ = cheerio.load(html);

  const robots = await fetchRobotsTxt(websiteUrl).catch((err) => {
    logEvent({ component: "techdetect-signals", message: "robots.txt fetch failed", status: "warn", error: formatError(err) });
    return null;
  });

  const [sitemapUrls, wellKnownProbes, dnsResult] = await Promise.all([
    discoverSitemapUrls(websiteUrl, robots?.sitemapUrls ?? []).catch(() => []),
    probeWellKnownPaths(homepage.finalUrl, robots?.isAllowed ?? (() => true)),
    resolveNameservers(new URL(homepage.finalUrl).hostname),
  ]);

  let tls: SiteSignals["tls"] = null;
  const finalUrlObj = new URL(homepage.finalUrl);
  if (finalUrlObj.protocol === "https:") {
    tls = await probeTls(finalUrlObj.hostname).catch(() => null);
  }

  return {
    requestedUrl: websiteUrl,
    finalUrl: homepage.finalUrl,
    statusCode: homepage.statusCode,
    headers: homepage.headers,
    html,
    cookies: ([] as string[]).concat((homepage.headers["set-cookie"] as string | string[] | undefined) ?? []),
    scripts: parseScripts($),
    metaTags: parseMetaTags($),
    linkTags: parseLinkTags($),
    forms: parseForms($),
    structuredData: extractStructuredData(html),
    bodyClassNames: parseBodyClassNames($),
    htmlAttributes: parseHtmlAttributes($),
    robots,
    sitemapUrls,
    wellKnownProbes,
    tls,
    dns: { nameservers: dnsResult },
  };
}
