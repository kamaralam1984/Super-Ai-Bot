import { describe, it, expect } from "vitest";
import { categorizeChunk, KNOWLEDGE_CATEGORIES, type KnowledgeCategory } from "./categoryClassifier";

describe("categorizeChunk", () => {
  it("exposes exactly the spec's 17-category taxonomy", () => {
    expect(KNOWLEDGE_CATEGORIES).toHaveLength(17);
    expect(new Set(KNOWLEDGE_CATEGORIES).size).toBe(17);
  });

  const titleCases: [string, KnowledgeCategory][] = [
    ["About Us", "Company"],
    ["Our Products", "Products"],
    ["Our Services", "Services"],
    ["Pricing Plans", "Pricing"],
    ["Frequently Asked Questions", "FAQs"],
    ["Company Blog", "Blogs"],
    ["Privacy Policy", "Policies"],
    ["Help Center", "Support"],
    ["Contact Us", "Contact"],
    ["Careers at Acme", "Careers"],
    ["API Documentation", "Documentation"],
    ["How to Reset Your Password", "Tutorials"],
    ["Downloads", "Downloads"],
    ["Case Study: Acme Corp", "Case Studies"],
    ["Our Portfolio", "Portfolio"],
    ["Customer Testimonials", "Testimonials"],
    ["Announcement: New Feature", "Announcements"],
  ];

  it.each(titleCases)("classifies a chunk titled %j as %s", (title, expected) => {
    const result = categorizeChunk({ content: "Some body text that doesn't contain any category keyword itself.", title });
    expect(result.category).toBe(expected);
  });

  it("gives a title-signal match high confidence when no other category scores", () => {
    const result = categorizeChunk({ content: "Generic body text.", title: "Pricing Plans" });
    expect(result.confidence).toBe(1);
  });

  it("uses the source URL path as a signal", () => {
    const result = categorizeChunk({ content: "Learn about what we do.", sourceUrl: "https://example.com/careers/openings" });
    expect(result.category).toBe("Careers");
  });

  it("uses Phase 2's page-level pageType as a prior even with no keyword match", () => {
    const result = categorizeChunk({ content: "This paragraph has no obvious category keywords in it at all.", pageType: "faq" });
    expect(result.category).toBe("FAQs");
  });

  it("lets a strong keyword match override a weaker conflicting page-type prior", () => {
    // pageType says "blog", but this chunk is clearly a pricing table.
    const result = categorizeChunk({
      content: "| Plan | Price |\n| --- | --- |\n| Starter | $10/month |\n| Pro | $30/month |",
      title: "Pricing",
      pageType: "blog",
    });
    expect(result.category).toBe("Pricing");
  });

  it("falls back to Company when nothing matches and there is no page-type hint", () => {
    const result = categorizeChunk({ content: "xyzzy plugh qwerty" });
    expect(result.category).toBe("Company");
    expect(result.confidence).toBe(0);
  });

  it("gives higher confidence when title, section, and content all agree than a single weak content mention", () => {
    const strong = categorizeChunk({
      content: "Our support team is here to help. Contact support for troubleshooting any issue.",
      title: "Support",
      section: "Help Center > Support",
    });
    const weak = categorizeChunk({
      content: "We mention support briefly here, but this chunk is really about something else entirely, like our founding story and our team's history.",
      title: "About Us",
    });
    expect(strong.category).toBe("Support");
    expect(weak.category).toBe("Company");
    expect(strong.confidence).toBeGreaterThan(0.5);
  });

  it("caps runaway content-keyword repetition instead of letting it score unboundedly", () => {
    const words = (n: number) => Array.from({ length: n }, () => "download").join(" ");
    const atCap = categorizeChunk({ content: words(5) });
    const wayOverCap = categorizeChunk({ content: words(50) });
    expect(atCap.category).toBe("Downloads");
    expect(wayOverCap.category).toBe("Downloads");
    // 50 repeats shouldn't score any higher than 5 — both are capped at the same MAX_CONTENT_MATCHES ceiling.
    expect(wayOverCap.confidence).toBe(atCap.confidence);
  });
});
