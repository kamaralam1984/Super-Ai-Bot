import * as cheerio from "cheerio";

export interface StructuredDataResult {
  jsonLd: Record<string, unknown>[];
  openGraph: Record<string, string>;
  twitterCard: Record<string, string>;
}

function flattenJsonLd(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed.flatMap(flattenJsonLd);
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj["@graph"])) return flattenJsonLd(obj["@graph"]);
    return [obj];
  }
  return [];
}

/** Extracts every JSON-LD block, Open Graph tag, and Twitter Card tag from a page's <head>/<body>. */
export function extractStructuredData(html: string): StructuredDataResult {
  const $ = cheerio.load(html);
  const jsonLd: Record<string, unknown>[] = [];

  $('script[type="application/ld+json"]').each((_i, el) => {
    const raw = $(el).contents().text();
    if (!raw?.trim()) return;
    try {
      jsonLd.push(...flattenJsonLd(JSON.parse(raw)));
    } catch {
      // malformed JSON-LD on the page — skip rather than fail the whole parse
    }
  });

  const openGraph: Record<string, string> = {};
  $('meta[property^="og:"]').each((_i, el) => {
    const property = $(el).attr("property");
    const content = $(el).attr("content");
    if (property && content) openGraph[property.slice(3)] = content;
  });

  const twitterCard: Record<string, string> = {};
  $('meta[name^="twitter:"]').each((_i, el) => {
    const name = $(el).attr("name");
    const content = $(el).attr("content");
    if (name && content) twitterCard[name.slice(8)] = content;
  });

  return { jsonLd, openGraph, twitterCard };
}

/** Finds JSON-LD blocks whose @type matches one of the given schema.org types (case-insensitive, handles array @type). */
export function findJsonLdByType(jsonLd: Record<string, unknown>[], types: string[]): Record<string, unknown>[] {
  const wanted = new Set(types.map((t) => t.toLowerCase()));
  return jsonLd.filter((entry) => {
    const type = entry["@type"];
    const typeList = Array.isArray(type) ? type : [type];
    return typeList.some((t) => typeof t === "string" && wanted.has(t.toLowerCase()));
  });
}
