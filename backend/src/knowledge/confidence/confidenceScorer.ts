import type { KnowledgeCategory } from "../categorize/categoryClassifier";

export interface ConfidenceFactors {
  sourceAuthority: number;
  contentQuality: number;
  recency: number;
  completeness: number;
  duplicateCorroboration: number;
  ocrAccuracy: number;
  embeddingQuality: number;
}

export interface ConfidenceScoreInput {
  content: string;
  /** Phase 2's structured_data|heuristic distinction for extracted products/services/FAQs — absent for plain page/document text. */
  extractionSource?: "structured_data" | "heuristic" | null;
  fetchedAt?: Date | null;
  category?: KnowledgeCategory | null;
  /** set when the source document extraction reported an error (e.g. hit a size cap, malformed file) */
  extractionErrorMessage?: string | null;
  /** how many independent source pages/documents produced this exact (or near-duplicate) content — 1 if unique */
  duplicateClusterSize?: number;
  /** Tesseract's 0-100 mean confidence, only when this content came from OCR */
  ocrConfidence?: number | null;
  embeddingIsStale?: boolean;
}

export interface ConfidenceScoreResult {
  overallScore: number;
  factors: ConfidenceFactors;
}

function scoreSourceAuthority(extractionSource: ConfidenceScoreInput["extractionSource"]): number {
  if (extractionSource === "structured_data") return 1.0; // the site's own schema.org/JSON-LD data — authoritative
  if (extractionSource === "heuristic") return 0.7; // pattern-matched from page markup — usually right, sometimes not
  return 0.85; // not applicable (plain page/document text) — neutral-good default
}

function scoreContentQuality(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  let score = 1.0;
  if (trimmed.length < 20) score -= 0.4; // too short to carry standalone meaning
  else if (trimmed.length < 50) score -= 0.15;
  const alnumRatio = (trimmed.match(/[\p{L}\p{N}]/gu)?.length ?? 0) / trimmed.length;
  if (alnumRatio < 0.4) score -= 0.35; // mostly symbols/whitespace — likely a broken extraction
  if (trimmed.includes("�")) score -= 0.3; // unicode replacement character — encoding corruption slipped through
  return Math.max(0, Math.min(1, score));
}

// Content whose accuracy meaningfully decays over time (a price list, a
// blog post, an announcement) vs. content that stays roughly true for a
// long time (company history, documentation, a past case study) — used to
// soften the recency penalty for evergreen categories rather than treating
// all content as equally time-sensitive.
const EVERGREEN_CATEGORIES = new Set<KnowledgeCategory>([
  "Company",
  "Documentation",
  "Portfolio",
  "Case Studies",
  "Testimonials",
  "Contact",
  "Careers",
  "Support",
  "Downloads",
  "Tutorials",
  "Policies",
]);
const TIME_SENSITIVE_HALF_LIFE_DAYS = 180;
const EVERGREEN_HALF_LIFE_DAYS = 720;
const RECENCY_FLOOR = 0.3; // stale content is still worth surfacing with reduced trust, not zeroed out entirely

function scoreRecency(fetchedAt: Date | null | undefined, category: KnowledgeCategory | null | undefined, now: Date): number {
  if (!fetchedAt) return 0.75; // unknown age — neutral, not penalized heavily
  const ageDays = Math.max(0, (now.getTime() - fetchedAt.getTime()) / (1000 * 60 * 60 * 24));
  const halfLife = category && EVERGREEN_CATEGORIES.has(category) ? EVERGREEN_HALF_LIFE_DAYS : TIME_SENSITIVE_HALF_LIFE_DAYS;
  const decayed = Math.pow(0.5, ageDays / halfLife);
  return Math.max(RECENCY_FLOOR, decayed);
}

function scoreCompleteness(extractionErrorMessage: string | null | undefined): number {
  return extractionErrorMessage ? 0.4 : 1.0;
}

function scoreDuplicateCorroboration(clusterSize: number): number {
  if (clusterSize <= 1) return 0.7; // single-source — fine, just not independently corroborated
  if (clusterSize === 2) return 0.85;
  return 1.0; // 3+ independent sources agree
}

function scoreOcrAccuracy(ocrConfidence: number | null | undefined): number {
  if (ocrConfidence == null) return 1.0; // not OCR-derived — not applicable
  return Math.max(0, Math.min(1, ocrConfidence / 100));
}

function scoreEmbeddingQuality(content: string, embeddingIsStale: boolean | undefined): number {
  let score = 1.0;
  if (embeddingIsStale) score -= 0.5;
  if (content.trim().length < 15) score -= 0.3; // embeddings of near-empty text are unreliable
  return Math.max(0, Math.min(1, score));
}

const WEIGHTS: Record<keyof ConfidenceFactors, number> = {
  sourceAuthority: 0.15,
  contentQuality: 0.25,
  recency: 0.1,
  completeness: 0.2,
  duplicateCorroboration: 0.1,
  ocrAccuracy: 0.1,
  embeddingQuality: 0.1,
};

/**
 * Multi-factor confidence scoring for a knowledge chunk, computed once at
 * index time and stored on the row (KnowledgeChunk.confidenceScore).
 *
 * Deliberately does NOT include "semantic match" from the spec's factor
 * list — that's a *query-time* signal (how well this chunk matches a
 * specific search query), already produced per-query by
 * search/searchEngine.ts, not a fixed property of the chunk itself.
 * Conflating the two would mean re-scoring every chunk on every query.
 * The citation/grounded-response layer (citation/citationFormatter.ts)
 * combines this static score with the search engine's per-query relevance
 * score when deciding whether an answer is well-supported enough to give.
 */
export function scoreConfidence(input: ConfidenceScoreInput, now: Date = new Date()): ConfidenceScoreResult {
  const factors: ConfidenceFactors = {
    sourceAuthority: scoreSourceAuthority(input.extractionSource),
    contentQuality: scoreContentQuality(input.content),
    recency: scoreRecency(input.fetchedAt, input.category, now),
    completeness: scoreCompleteness(input.extractionErrorMessage),
    duplicateCorroboration: scoreDuplicateCorroboration(input.duplicateClusterSize ?? 1),
    ocrAccuracy: scoreOcrAccuracy(input.ocrConfidence),
    embeddingQuality: scoreEmbeddingQuality(input.content, input.embeddingIsStale),
  };

  // Content quality acts as a gate, not just one weighted factor among
  // equals: a chunk with no real content can't be "confident" about
  // anything regardless of how authoritative or fresh its source is, so
  // zero content quality zeroes the whole score rather than letting the
  // other six factors' weight carry it to a misleadingly non-zero result.
  if (factors.contentQuality === 0) {
    return { overallScore: 0, factors };
  }

  const overallScore = (Object.keys(WEIGHTS) as (keyof ConfidenceFactors)[]).reduce((sum, key) => sum + factors[key] * WEIGHTS[key], 0);

  return { overallScore: Math.max(0, Math.min(1, overallScore)), factors };
}
