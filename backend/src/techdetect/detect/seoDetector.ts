import type { SiteSignals, DetectionCandidate } from "../types";
import { CandidateBuilder, htmlAndScriptsHaystack, wellKnownPathFound } from "./signalUtils";

/**
 * SEO tooling detection — reuses Phase 2's already-extracted structured
 * data (`signals.structuredData`) for Schema.org/OpenGraph/Twitter Cards
 * rather than re-parsing HTML, and Phase 2's robots.txt/sitemap discovery
 * for those two categories, so this detector only adds genuinely new
 * signal-gathering for the SEO *plugins* themselves.
 */
export function detectSeoTools(signals: SiteSignals): DetectionCandidate[] {
  const html = htmlAndScriptsHaystack(signals);
  const builder = new CandidateBuilder();

  // WordPress SEO plugins each leave a literal, documented HTML comment
  // signature announcing themselves — the single most reliable signal in
  // this whole category, not an inference.
  if (/optimized with the Yoast SEO plugin/i.test(signals.html)) builder.add("Yoast SEO", "Yoast SEO's own HTML comment signature found", 0.95);
  if (/class="[^"]*\byoast-seo\b/i.test(html) || /yoast_seo/i.test(html)) builder.add("Yoast SEO", "Yoast-branded class/identifier found", 0.6);

  if (/optimized with the seo plugin rank math/i.test(signals.html)) builder.add("Rank Math", "Rank Math's own HTML comment signature found", 0.95);
  if (/rank-math/i.test(html)) builder.add("Rank Math", "rank-math-branded identifier found", 0.6);

  if (/all in one seo/i.test(signals.html) && /<!--/.test(signals.html)) builder.add("AIO SEO", "All in One SEO's own HTML comment signature found", 0.85);
  if (/aioseo/i.test(html)) builder.add("AIO SEO", "aioseo-branded identifier found", 0.6);

  if (/name="google-site-verification"/i.test(html)) builder.add("Google Search Console", "google-site-verification meta tag found", 0.9);

  // Schema.org / OpenGraph / Twitter Cards — Phase 2 already parsed these.
  if (signals.structuredData.jsonLd.length > 0) {
    builder.add("Schema.org", `${signals.structuredData.jsonLd.length} JSON-LD structured data block(s) found`, 0.9);
  }
  if (Object.keys(signals.structuredData.openGraph).length > 0) {
    builder.add("Open Graph", `${Object.keys(signals.structuredData.openGraph).length} og:* meta tag(s) found`, 0.9);
  }
  if (Object.keys(signals.structuredData.twitterCard).length > 0) {
    builder.add("Twitter Cards", `${Object.keys(signals.structuredData.twitterCard).length} twitter:* meta tag(s) found`, 0.9);
  }

  // Canonical tag
  if (signals.linkTags.some((l) => l.rel?.toLowerCase() === "canonical")) {
    builder.add("Canonical Tags", "<link rel=\"canonical\"> found", 0.95);
  }

  // XML sitemap
  if (signals.sitemapUrls.length > 0 || wellKnownPathFound(signals, "/sitemap.xml")) {
    builder.add("XML Sitemap", signals.sitemapUrls.length > 0 ? `sitemap resolved with ${signals.sitemapUrls.length} URL(s)` : "/sitemap.xml is reachable", 0.9);
  }

  // robots.txt
  if (signals.robots?.found) {
    builder.add("Robots.txt", "robots.txt is present and was successfully parsed", 0.95);
  }

  return builder.build();
}
