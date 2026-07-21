import type { VectorStore } from "../vector/vectorStore";

export type SearchMode = "semantic" | "keyword" | "hybrid";

export interface SearchCandidate {
  chunkId: string;
  content: string;
}

export interface RankedResult {
  chunkId: string;
  /** Final ranking score for whichever mode produced this result — not comparable across modes (cosine similarity vs. BM25 vs. RRF are different scales). */
  score: number;
  semanticScore?: number;
  keywordScore?: number;
}

// English function words filtered out before BM25 scoring — on a small
// candidate set (a single site's knowledge base, not a web-scale corpus)
// IDF alone doesn't discount them enough: two documents that only share
// words like "you"/"for"/"the" can otherwise outscore a real topical
// match. Deliberately English-only (documented scope boundary, matching
// this project's practice elsewhere): other languages still get correct,
// real BM25 scoring — just without stopword removal, since a wrong
// stopword list would be worse than none.
const ENGLISH_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "so", "of", "in", "on", "at", "to", "for", "with",
  "by", "from", "up", "about", "into", "over", "after",
  "is", "am", "are", "was", "were", "be", "been", "being", "do", "does", "did", "doing",
  "have", "has", "had", "having",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their",
  "this", "that", "these", "those", "as", "not", "no", "yes",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "what", "when", "where", "who", "whom", "which", "why", "how",
]);

function tokenize(text: string): string[] {
  // Unicode-aware: \p{L}/\p{N} match letters/digits in any script (Latin,
  // Devanagari, Arabic, ...), not just ASCII — needed for the product's
  // multi-language content. BM25 here does exact term matching with no
  // stemming, so "refund" and "refunds" are distinct terms — another
  // deliberate, documented simplification rather than a hidden gap.
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.filter((t) => !ENGLISH_STOPWORDS.has(t));
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * Real BM25 ranking (Okapi BM25 — the same scoring family used by
 * Elasticsearch/Lucene by default) over an in-memory candidate set. This
 * engine module stays database-free like its siblings (chunker,
 * embeddings, vectorStore) — the orchestrator is responsible for fetching
 * the candidate chunks (typically an already category/language-filtered
 * slice) from Postgres and handing them in.
 */
export function keywordSearch(query: string, candidates: SearchCandidate[], k: number): RankedResult[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || candidates.length === 0 || k <= 0) return [];

  const docTokens = candidates.map((c) => tokenize(c.content));
  const docLengths = docTokens.map((tokens) => tokens.length);
  const avgDocLength = docLengths.reduce((sum, len) => sum + len, 0) / docLengths.length || 1;

  const termFreqsPerDoc: Map<string, number>[] = docTokens.map((tokens) => {
    const freq = new Map<string, number>();
    for (const token of tokens) freq.set(token, (freq.get(token) ?? 0) + 1);
    return freq;
  });

  const termDocFrequency = new Map<string, number>();
  for (const freq of termFreqsPerDoc) {
    for (const term of freq.keys()) termDocFrequency.set(term, (termDocFrequency.get(term) ?? 0) + 1);
  }

  const totalDocs = candidates.length;
  const results: RankedResult[] = candidates.map((candidate, i) => {
    let score = 0;
    for (const term of queryTerms) {
      const docsContainingTerm = termDocFrequency.get(term) ?? 0;
      const termFrequency = termFreqsPerDoc[i].get(term) ?? 0;
      if (docsContainingTerm === 0 || termFrequency === 0) continue;

      const idf = Math.log((totalDocs - docsContainingTerm + 0.5) / (docsContainingTerm + 0.5) + 1);
      const lengthNorm = 1 - BM25_B + (BM25_B * docLengths[i]) / avgDocLength;
      score += idf * ((termFrequency * (BM25_K1 + 1)) / (termFrequency + BM25_K1 * lengthNorm));
    }
    return { chunkId: candidate.chunkId, score, keywordScore: score };
  });

  return results
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Thin wrapper over VectorStore.search that normalizes results into the shared RankedResult shape used for fusion. */
export function semanticSearch(
  vectorStore: VectorStore,
  namespace: string,
  queryVector: number[],
  k: number,
  options: { filterChunkIds?: Set<string> } = {}
): RankedResult[] {
  return vectorStore.search(namespace, queryVector, k, options).map((hit) => ({ chunkId: hit.chunkId, score: hit.score, semanticScore: hit.score }));
}

const DEFAULT_RRF_K = 60; // standard Reciprocal Rank Fusion constant (matches Elasticsearch's default)

/**
 * Combines multiple independently-ranked result lists (e.g. semantic +
 * keyword) via Reciprocal Rank Fusion: each list contributes 1/(rrfK +
 * rank) to every chunk it contains, then contributions are summed. RRF is
 * used instead of a weighted sum of raw scores because cosine similarity
 * and BM25 scores live on incomparable scales — fusing by *rank* rather
 * than by raw score avoids having to invent a normalization between them.
 */
export function fuseRankings(rankedLists: RankedResult[][], k: number, rrfK = DEFAULT_RRF_K): RankedResult[] {
  const fused = new Map<string, RankedResult>();

  for (const list of rankedLists) {
    list.forEach((item, rank) => {
      const contribution = 1 / (rrfK + rank + 1);
      const existing = fused.get(item.chunkId);
      if (existing) {
        existing.score += contribution;
        if (item.semanticScore !== undefined) existing.semanticScore = item.semanticScore;
        if (item.keywordScore !== undefined) existing.keywordScore = item.keywordScore;
      } else {
        fused.set(item.chunkId, { chunkId: item.chunkId, score: contribution, semanticScore: item.semanticScore, keywordScore: item.keywordScore });
      }
    });
  }

  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

export interface HybridSearchParams {
  vectorStore: VectorStore;
  namespace: string;
  queryVector: number[];
  query: string;
  /** Candidate chunks for keyword scoring — typically an already category/language-filtered slice loaded by the caller from Postgres. */
  candidates: SearchCandidate[];
  k: number;
  mode?: SearchMode;
  /** Restricts results to this set of chunk IDs in both the semantic and keyword passes (e.g. a category or language filter already resolved to chunk IDs). */
  filterChunkIds?: Set<string>;
}

/** Runs semantic, keyword, or hybrid (fused) search depending on `mode` (default "hybrid"), applying `filterChunkIds` consistently across both retrieval paths. */
export function search(params: HybridSearchParams): RankedResult[] {
  const mode = params.mode ?? "hybrid";
  const candidates = params.filterChunkIds ? params.candidates.filter((c) => params.filterChunkIds!.has(c.chunkId)) : params.candidates;

  if (mode === "keyword") {
    return keywordSearch(params.query, candidates, params.k);
  }
  if (mode === "semantic") {
    return semanticSearch(params.vectorStore, params.namespace, params.queryVector, params.k, { filterChunkIds: params.filterChunkIds });
  }

  // Widen each individual pass beyond k before fusing, so a chunk that
  // ranks just outside the top-k on one axis but well within it on the
  // other still has a chance to surface in the fused top-k.
  const widenedK = Math.max(params.k * 3, params.k + 10);
  const semanticResults = semanticSearch(params.vectorStore, params.namespace, params.queryVector, widenedK, { filterChunkIds: params.filterChunkIds });
  const keywordResults = keywordSearch(params.query, candidates, widenedK);
  return fuseRankings([semanticResults, keywordResults], params.k);
}
