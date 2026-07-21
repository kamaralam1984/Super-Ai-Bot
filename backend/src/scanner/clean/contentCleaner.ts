import type { ParsedPageContent } from "../parse/htmlParser";

/**
 * The canonical noise-removal selector list — owned here since "content
 * cleaning" is this module's concern, imported by htmlParser.ts so
 * extraction and cleaning never drift apart into two different definitions
 * of "noise."
 */
export const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "[hidden]",
  "[aria-hidden='true']",
  "[style*='display:none']",
  "[style*='display: none']",
  // cookie / consent banners
  "[class*=cookie-consent]",
  "[id*=cookie-consent]",
  "[class*=cookie-banner]",
  "[id*=cookie-banner]",
  "[class*=gdpr]",
  "[id*=gdpr]",
  "[class*=consent-banner]",
  // advertisements
  "ins.adsbygoogle",
  "[id*=google_ads]",
  "[class*=advertisement]",
  "[class*=ad-banner]",
  "[class*=ad-container]",
  "iframe[src*=doubleclick]",
  "iframe[src*=googlesyndication]",
].join(", ");

/**
 * Assembles the final coherent "clean text" for a page from its already-
 * extracted structured fields (title, headings, paragraphs, lists, tables)
 * — explicitly excluding navigation, footer, forms, and raw structured-data
 * blocks, which are real content but not prose worth embedding into the
 * knowledge base. This is what Task 29's chunker consumes.
 */
export function buildCleanText(parsed: ParsedPageContent): string {
  const parts: string[] = [];

  if (parsed.title) parts.push(parsed.title);
  parts.push(...parsed.headings.h1, ...parsed.headings.h2, ...parsed.headings.h3, ...parsed.headings.h4);
  parts.push(...parsed.paragraphs);
  for (const list of parsed.lists) parts.push(list.items.join("; "));
  for (const table of parsed.tables) {
    if (table.headers.length > 0) parts.push(table.headers.join(" | "));
    for (const row of table.rows) parts.push(row.join(" | "));
  }

  // De-duplicate identical lines within the SAME page (e.g. a heading
  // repeated as both an <h2> and inside a breadcrumb) without touching
  // cross-page duplication, which is duplicateDetector's job.
  const seen = new Set<string>();
  const unique = parts.map((p) => p.trim()).filter((p) => {
    if (!p || seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  return unique.join("\n\n");
}
