import { describe, it, expect } from "vitest";
import { detectSeoTools } from "./seoDetector";
import { buildSignals } from "../testFixtures";
import { collectSignals } from "../signals/signalCollector";

function namesOf(result: ReturnType<typeof detectSeoTools>): string[] {
  return result.map((c) => c.name);
}

describe("detectSeoTools — synthetic signatures", () => {
  it("detects Yoast SEO from its own HTML comment signature", () => {
    const signals = buildSignals({ html: "<!-- This site is optimized with the Yoast SEO plugin v21.9 - https://yoast.com/wordpress/plugins/seo/ -->" });
    expect(namesOf(detectSeoTools(signals))).toContain("Yoast SEO");
  });

  it("detects Rank Math from its own HTML comment signature", () => {
    const signals = buildSignals({ html: "<!-- This site is optimized with the SEO plugin Rank Math version 1.0.200 -->" });
    expect(namesOf(detectSeoTools(signals))).toContain("Rank Math");
  });

  it("detects AIO SEO from its comment signature", () => {
    const signals = buildSignals({ html: "<!-- This site uses the All in One SEO plugin -->" });
    expect(namesOf(detectSeoTools(signals))).toContain("AIO SEO");
  });

  it("detects Google Search Console from the verification meta tag", () => {
    const signals = buildSignals({ html: '<meta name="google-site-verification" content="abc123xyz">' });
    expect(namesOf(detectSeoTools(signals))).toContain("Google Search Console");
  });

  it("detects Schema.org from Phase 2's already-parsed JSON-LD", () => {
    const signals = buildSignals({ structuredData: { jsonLd: [{ "@type": "Organization" }], openGraph: {}, twitterCard: {} } });
    expect(namesOf(detectSeoTools(signals))).toContain("Schema.org");
  });

  it("detects Open Graph and Twitter Cards from Phase 2's already-parsed meta tags", () => {
    const signals = buildSignals({ structuredData: { jsonLd: [], openGraph: { title: "Home" }, twitterCard: { card: "summary" } } });
    const names = namesOf(detectSeoTools(signals));
    expect(names).toContain("Open Graph");
    expect(names).toContain("Twitter Cards");
  });

  it("detects canonical tags", () => {
    const signals = buildSignals({ linkTags: [{ rel: "canonical", href: "https://example.com/page", as: null }] });
    expect(namesOf(detectSeoTools(signals))).toContain("Canonical Tags");
  });

  it("detects an XML sitemap from resolved sitemap URLs", () => {
    const signals = buildSignals({ sitemapUrls: ["https://example.com/page-1", "https://example.com/page-2"] });
    expect(namesOf(detectSeoTools(signals))).toContain("XML Sitemap");
  });

  it("detects robots.txt presence from the parsed robots info", () => {
    const signals = buildSignals({ robots: { found: true, isAllowed: () => true, crawlDelayMs: null, sitemapUrls: [], rawContent: "User-agent: *\nAllow: /" } });
    expect(namesOf(detectSeoTools(signals))).toContain("Robots.txt");
  });

  it("does not report robots.txt when it was not found", () => {
    const signals = buildSignals({ robots: { found: false, isAllowed: () => true, crawlDelayMs: null, sitemapUrls: [], rawContent: null } });
    expect(namesOf(detectSeoTools(signals))).not.toContain("Robots.txt");
  });

  it("returns no candidates when nothing matches", () => {
    expect(detectSeoTools(buildSignals())).toEqual([]);
  });
});

describe("detectSeoTools — real websites", () => {
  it("detects real SEO signals on a real WordPress news site", async () => {
    const signals = await collectSignals("https://wptavern.com");
    const names = namesOf(detectSeoTools(signals));
    expect(names).toContain("Open Graph");
    expect(names).toContain("Canonical Tags");
    expect(names).toContain("XML Sitemap");
    expect(names).toContain("Robots.txt");
  }, 30000);
});
