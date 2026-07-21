import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { extractStructuredData, type StructuredDataResult } from "./structuredData";
import { extractContactInfo, type ContactInfo } from "./contactExtractor";
import { NOISE_SELECTORS } from "../clean/contentCleaner";

export interface HeadingSet {
  h1: string[];
  h2: string[];
  h3: string[];
  h4: string[];
  h5: string[];
  h6: string[];
}

export interface ExtractedImage {
  src: string;
  alt: string | null;
  caption: string | null;
}

export interface ExtractedVideo {
  src: string;
  type: "youtube" | "vimeo" | "native" | "other";
}

export interface ExtractedForm {
  action: string | null;
  method: string;
  fields: { name: string | null; type: string }[];
}

export interface ExtractedTable {
  headers: string[];
  rows: string[][];
}

export interface ParsedPageContent {
  title: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  headings: HeadingSet;
  paragraphs: string[];
  lists: { ordered: boolean; items: string[] }[];
  tables: ExtractedTable[];
  buttons: string[];
  ctaButtons: string[];
  breadcrumbs: string[];
  navigationMenu: string[];
  footerLinks: string[];
  images: ExtractedImage[];
  videos: ExtractedVideo[];
  forms: ExtractedForm[];
  contactInfo: ContactInfo;
  structuredData: StructuredDataResult;
}

const CTA_PATTERNS = /\b(buy now|shop now|add to cart|get started|sign up|subscribe|contact us|book now|order now|learn more|request a quote|free trial|download|call now|schedule|apply now|join now|register)\b/i;

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function textOf($el: cheerio.Cheerio<AnyNode>): string {
  return cleanText($el.text());
}

function classifyVideoSrc(src: string): ExtractedVideo["type"] {
  if (/youtube\.com|youtu\.be/i.test(src)) return "youtube";
  if (/vimeo\.com/i.test(src)) return "vimeo";
  return "other";
}

/**
 * The core Task 24 extractor: everything the spec's "Content Extraction"
 * section lists, from a single cheerio pass. Structured data and contact
 * info are delegated to their own modules (Task 24 scope, kept in separate
 * files since Task 25's product/service/FAQ detectors need the same
 * structured-data extraction independently).
 */
export function parsePageContent(html: string): ParsedPageContent {
  const $ = cheerio.load(html);
  $(NOISE_SELECTORS).remove();

  const title = cleanText($("title").first().text()) || null;
  const metaTitle = $('meta[property="og:title"]').attr("content")?.trim() || title;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || $('meta[property="og:description"]').attr("content")?.trim() || null;
  const canonicalUrl = $('link[rel="canonical"]').attr("href")?.trim() || null;

  const headings: HeadingSet = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] };
  (["h1", "h2", "h3", "h4", "h5", "h6"] as const).forEach((tag) => {
    $(tag).each((_i, el) => {
      const text = textOf($(el));
      if (text) headings[tag].push(text);
    });
  });

  const paragraphs: string[] = [];
  $("p").each((_i, el) => {
    const text = textOf($(el));
    if (text.length > 1) paragraphs.push(text);
  });

  const lists: ParsedPageContent["lists"] = [];
  $("ul, ol").each((_i, el) => {
    // Skip nav/footer lists here — they're captured separately as menu/footer links.
    if ($(el).closest("nav, footer, header").length > 0) return;
    const items = $(el)
      .children("li")
      .map((_j, li) => textOf($(li)))
      .get()
      .filter(Boolean);
    if (items.length > 0) lists.push({ ordered: el.tagName.toLowerCase() === "ol", items });
  });

  const tables: ExtractedTable[] = [];
  $("table").each((_i, el) => {
    const headers = $(el)
      .find("thead th, tr:first-child th")
      .map((_j, th) => textOf($(th)))
      .get();
    // NOTE: cheerio's chainable .map().get() flattens one level, jQuery-style
    // — nesting it here would collapse every row into one flat array of
    // cells, losing row boundaries entirely. .toArray() + native Array.map
    // keeps each row's cells as their own sub-array.
    const rows = $(el)
      .find("tbody tr")
      .toArray()
      .map((tr) => $(tr).find("td").map((_k, td) => textOf($(td))).get())
      .filter((row) => row.length > 0);
    if (headers.length > 0 || rows.length > 0) tables.push({ headers, rows });
  });

  const buttons = new Set<string>();
  const ctaButtons = new Set<string>();
  $("button, input[type=submit], input[type=button], a.btn, a[class*=button], a[class*=btn]").each((_i, el) => {
    const text = textOf($(el)) || $(el).attr("value") || "";
    if (!text) return;
    buttons.add(text);
    if (CTA_PATTERNS.test(text)) ctaButtons.add(text);
  });
  $("a").each((_i, el) => {
    const text = textOf($(el));
    if (text && CTA_PATTERNS.test(text)) ctaButtons.add(text);
  });

  const breadcrumbs: string[] = [];
  $('[class*=breadcrumb], nav[aria-label*=breadcrumb i], [itemtype*=BreadcrumbList]').first().find("a, span[itemprop=name]").each((_i, el) => {
    const text = textOf($(el));
    if (text) breadcrumbs.push(text);
  });

  const navigationMenu: string[] = [];
  $("nav a, header a").each((_i, el) => {
    const text = textOf($(el));
    if (text && !navigationMenu.includes(text)) navigationMenu.push(text);
  });

  const footerLinks: string[] = [];
  $("footer a").each((_i, el) => {
    const text = textOf($(el));
    if (text && !footerLinks.includes(text)) footerLinks.push(text);
  });

  const images: ExtractedImage[] = [];
  $("img").each((_i, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    if (!src) return;
    const alt = $(el).attr("alt")?.trim() || null;
    const caption = $(el).closest("figure").find("figcaption").first().text().trim() || null;
    images.push({ src, alt, caption: caption || null });
  });

  const videos: ExtractedVideo[] = [];
  $("iframe[src], video source[src], video[src]").each((_i, el) => {
    const src = $(el).attr("src");
    if (src) videos.push({ src, type: classifyVideoSrc(src) });
  });

  const forms: ExtractedForm[] = [];
  $("form").each((_i, el) => {
    const fields = $(el)
      .find("input, select, textarea")
      .map((_j, field) => ({ name: $(field).attr("name") || null, type: $(field).attr("type") || field.tagName.toLowerCase() }))
      .get();
    forms.push({ action: $(el).attr("action") || null, method: ($(el).attr("method") || "GET").toUpperCase(), fields });
  });

  const structuredData = extractStructuredData(html);
  const contactInfo = extractContactInfo(html, structuredData);

  return {
    title,
    metaTitle: metaTitle || null,
    metaDescription,
    canonicalUrl,
    headings,
    paragraphs,
    lists,
    tables,
    buttons: [...buttons],
    ctaButtons: [...ctaButtons],
    breadcrumbs,
    navigationMenu,
    footerLinks,
    images,
    videos,
    forms,
    contactInfo,
    structuredData,
  };
}
