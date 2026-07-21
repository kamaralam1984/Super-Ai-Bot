export interface CitableChunk {
  chunkId: string;
  content: string;
  sourceUrl: string;
  title?: string | null;
  category?: string | null;
  /** the chunk's static, index-time confidence score (confidence/confidenceScorer.ts) */
  confidenceScore: number;
}

export interface SearchHit extends CitableChunk {
  /** search/searchEngine.ts's RankedResult sub-scores — at least one should be present */
  semanticScore?: number;
  keywordScore?: number;
}

export interface CitationSource {
  chunkId: string;
  sourceUrl: string;
  title: string | null;
  category: string | null;
  excerpt: string;
  confidenceScore: number;
  relevanceScore: number;
}

export interface GroundedAnswer {
  answered: true;
  sources: CitationSource[];
  /** the top source's combined (relevance x confidence) score */
  overallConfidence: number;
}

export interface RefusedAnswer {
  answered: false;
  reason: string;
}

export type CitationResult = GroundedAnswer | RefusedAnswer;

/**
 * search/searchEngine.ts's RankedResult.score is on a different,
 * incomparable scale per mode (cosine similarity in "semantic" mode, raw
 * unbounded BM25 in "keyword" mode, tiny Reciprocal-Rank-Fusion values in
 * "hybrid" mode) — not something this module can compare against a fixed
 * confidence floor directly. Its `semanticScore`/`keywordScore` sub-fields
 * are more useful: semanticScore is cosine similarity, already ~[0,1] for
 * real text, used directly; keywordScore is unbounded BM25, saturated into
 * [0,1) via score/(score+k) — a standard normalization trick (k is "a
 * BM25 score this good is already a strong match", a documented heuristic
 * constant, not derived from this corpus).
 */
const BM25_SATURATION_CONSTANT = 5;
const DEFAULT_MIN_ANSWER_CONFIDENCE = 0.35;
const DEFAULT_MAX_SOURCES = 3;
const EXCERPT_MAX_LENGTH = 300;

function normalizeRelevance(hit: { semanticScore?: number; keywordScore?: number }): number {
  if (hit.semanticScore !== undefined) return Math.max(0, Math.min(1, hit.semanticScore));
  if (hit.keywordScore !== undefined) return hit.keywordScore / (hit.keywordScore + BM25_SATURATION_CONSTANT);
  return 0.5; // neither sub-score present — neutral, shouldn't normally happen
}

function truncateExcerpt(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= EXCERPT_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, EXCERPT_MAX_LENGTH).trim()}...`;
}

export interface FormatGroundedAnswerOptions {
  /** minimum combined (relevance x confidence) score required to cite a source at all — below this, refuse rather than answer from weak support */
  minConfidence?: number;
  maxSources?: number;
}

/**
 * Turns ranked search hits into either a grounded, cited answer or an
 * explicit refusal — the spec's "never answer from unsupported data"
 * requirement made concrete: a query with no hits, or whose best hit's
 * combined relevance-and-confidence score doesn't clear `minConfidence`,
 * refuses with a stated reason instead of surfacing a weak guess.
 *
 * Combines two independent signals multiplicatively (both matter — a
 * highly relevant match from unreliable content, or a reliable chunk
 * that's barely relevant to the query, should both pull the combined
 * score down rather than one compensating for the other): the search
 * engine's per-query relevance and confidenceScorer.ts's static,
 * index-time confidence.
 *
 * Multiple qualifying chunks from the same page are collapsed to one
 * citation (the strongest-scoring chunk from that page) so an answer
 * doesn't cite the same source URL twice.
 */
export function formatGroundedAnswer(hits: SearchHit[], options: FormatGroundedAnswerOptions = {}): CitationResult {
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_ANSWER_CONFIDENCE;
  const maxSources = options.maxSources ?? DEFAULT_MAX_SOURCES;

  if (hits.length === 0) {
    return { answered: false, reason: "No matching content was found in the knowledge base for this query." };
  }

  const scored = hits
    .map((hit) => {
      const relevance = normalizeRelevance(hit);
      return { hit, relevance, combined: relevance * hit.confidenceScore };
    })
    .sort((a, b) => b.combined - a.combined);

  const qualifying = scored.filter((s) => s.combined >= minConfidence);
  if (qualifying.length === 0) {
    return {
      answered: false,
      reason: `No content cleared the confidence floor (best match scored ${scored[0].combined.toFixed(2)}, needed ${minConfidence.toFixed(2)}).`,
    };
  }

  const seenUrls = new Set<string>();
  const sources: CitationSource[] = [];
  for (const s of qualifying) {
    if (seenUrls.has(s.hit.sourceUrl)) continue;
    seenUrls.add(s.hit.sourceUrl);
    sources.push({
      chunkId: s.hit.chunkId,
      sourceUrl: s.hit.sourceUrl,
      title: s.hit.title ?? null,
      category: s.hit.category ?? null,
      excerpt: truncateExcerpt(s.hit.content),
      confidenceScore: s.hit.confidenceScore,
      relevanceScore: s.relevance,
    });
    if (sources.length >= maxSources) break;
  }

  return { answered: true, sources, overallConfidence: qualifying[0].combined };
}
