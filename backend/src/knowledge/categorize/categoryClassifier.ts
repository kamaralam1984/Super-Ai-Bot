export type KnowledgeCategory =
  | "Company"
  | "Products"
  | "Services"
  | "Pricing"
  | "FAQs"
  | "Blogs"
  | "Policies"
  | "Support"
  | "Contact"
  | "Careers"
  | "Documentation"
  | "Tutorials"
  | "Downloads"
  | "Case Studies"
  | "Portfolio"
  | "Testimonials"
  | "Announcements";

export const KNOWLEDGE_CATEGORIES: readonly KnowledgeCategory[] = [
  "Company",
  "Products",
  "Services",
  "Pricing",
  "FAQs",
  "Blogs",
  "Policies",
  "Support",
  "Contact",
  "Careers",
  "Documentation",
  "Tutorials",
  "Downloads",
  "Case Studies",
  "Portfolio",
  "Testimonials",
  "Announcements",
];

const CATEGORY_PATTERNS: Record<KnowledgeCategory, RegExp> = {
  Company: /\b(about us|who we are|our story|our mission|our vision|our team|company overview|founded in|our history|leadership team)\b/i,
  Products: /\b(products?|shop now|add to cart|buy now|catalog|specifications?|\bsku\b|in stock|out of stock)\b/i,
  Services: /\b(services?|solutions?|we offer|our offerings|consulting|managed service)\b/i,
  Pricing: /\b(pricing|price list|plans?|subscriptions?|per month|per year|free trial|billing|tiers?)\b/i,
  FAQs: /\b(faqs?|frequently asked questions?|q\s*&\s*a)\b/i,
  Blogs: /\b(blog|article|published on|posted on|read more|latest news)\b/i,
  Policies: /\b(privacy policy|terms of service|terms and conditions|refund policy|shipping policy|cookie policy|disclaimer|gdpr|legal notice)\b/i,
  Support: /\b(support|help cent(er|re)|help desk|troubleshoot(ing)?|customer service|support ticket)\b/i,
  Contact: /\b(contact us|get in touch|email us|call us|our location|reach out to us)\b/i,
  Careers: /\b(careers?|job openings?|we'?re hiring|apply now|join our team|vacanc(y|ies))\b/i,
  Documentation: /\b(documentation|\bdocs\b|api reference|developer guide|getting started|installation guide|configuration guide)\b/i,
  Tutorials: /\b(tutorials?|how[-\s]to|step[-\s]by[-\s]step|walkthrough|learn how to)\b/i,
  Downloads: /\b(downloads?|brochure|datasheet|free download|get the app)\b/i,
  "Case Studies": /\b(case stud(y|ies)|success story|client story|results achieved)\b/i,
  Portfolio: /\b(portfolio|our work|showcase|our projects)\b/i,
  Testimonials: /\b(testimonials?|customer reviews?|what our customers say|5[-\s]star|highly rated)\b/i,
  Announcements: /\b(announcements?|press release|we'?re excited to announce|new feature|release notes|coming soon)\b/i,
};

// Phase 2's page-level classifier (scanner/parse/pageTypeClassifier.ts)
// produces coarser types; used here only as one extra scoring signal
// alongside the finer chunk-level keyword patterns above, not as a
// substitute for them — a page classified "documentation" can still
// contain a chunk that's really an FAQ, a pricing table, etc.
const PAGE_TYPE_PRIOR: Partial<Record<string, KnowledgeCategory>> = {
  about: "Company",
  home: "Company",
  product: "Products",
  service: "Services",
  pricing: "Pricing",
  blog: "Blogs",
  faq: "FAQs",
  contact: "Contact",
  policy: "Policies",
  gallery: "Portfolio",
  testimonials: "Testimonials",
  documentation: "Documentation",
  career: "Careers",
};

export interface CategorizationInput {
  content: string;
  /** the chunk's nearest heading text, if any */
  title?: string | null;
  /** the chunk's full heading path, if any */
  section?: string | null;
  sourceUrl?: string | null;
  /** Phase 2's page-level classification for the source page, if this chunk came from a crawled page */
  pageType?: string | null;
}

export interface CategorizationResult {
  category: KnowledgeCategory;
  /** 0-1, this category's share of total signal across all categories that matched at all */
  confidence: number;
}

const TITLE_WEIGHT = 4;
const SECTION_WEIGHT = 3;
const URL_WEIGHT = 2;
const CONTENT_WEIGHT = 1;
const MAX_CONTENT_MATCHES = 5; // caps keyword-stuffing from dominating the score
const PAGE_TYPE_PRIOR_WEIGHT = 2;

// Nothing in the 17-category taxonomy is a general-purpose "Other" bucket,
// so content with no keyword match and no page-type hint (e.g. a stray
// table with no surrounding context) needs *some* home. "Company" — the
// broadest, most general-purpose category — is the documented, deliberate
// default rather than a silent guess.
const FALLBACK_CATEGORY: KnowledgeCategory = "Company";

/**
 * Classifies a knowledge chunk into the spec's 17-category taxonomy using
 * multiple weighted signals: an explicit heading title/section carries the
 * most weight (an author-labeled "Pricing" section is strong evidence),
 * the source URL path next, then in-content keyword density (capped so a
 * long chunk that happens to repeat a word can't dominate), plus a small
 * boost from Phase 2's page-level classification when available.
 */
export function categorizeChunk(input: CategorizationInput): CategorizationResult {
  const scores: Partial<Record<KnowledgeCategory, number>> = {};

  let urlPath = "";
  if (input.sourceUrl) {
    try {
      urlPath = new URL(input.sourceUrl).pathname;
    } catch {
      urlPath = input.sourceUrl;
    }
  }

  for (const category of KNOWLEDGE_CATEGORIES) {
    const pattern = CATEGORY_PATTERNS[category];
    let score = 0;

    if (input.title && pattern.test(input.title)) score += TITLE_WEIGHT;
    if (input.section && pattern.test(input.section)) score += SECTION_WEIGHT;
    if (urlPath && pattern.test(urlPath)) score += URL_WEIGHT;

    const contentMatches = input.content.match(new RegExp(pattern.source, "gi"))?.length ?? 0;
    score += Math.min(contentMatches, MAX_CONTENT_MATCHES) * CONTENT_WEIGHT;

    if (input.pageType && PAGE_TYPE_PRIOR[input.pageType] === category) score += PAGE_TYPE_PRIOR_WEIGHT;

    if (score > 0) scores[category] = score;
  }

  const entries = Object.entries(scores) as [KnowledgeCategory, number][];
  if (entries.length === 0) {
    return { category: FALLBACK_CATEGORY, confidence: 0 };
  }

  entries.sort((a, b) => b[1] - a[1]);
  const [topCategory, topScore] = entries[0];
  const totalScore = entries.reduce((sum, [, s]) => sum + s, 0);

  return { category: topCategory, confidence: Math.min(1, topScore / totalScore) };
}
