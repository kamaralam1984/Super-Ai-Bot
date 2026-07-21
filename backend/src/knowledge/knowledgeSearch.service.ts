import { KnowledgeRecordService } from "./knowledgeRecord.service";
import { getDefaultVectorStore } from "./vector/vectorStore";
import { embedText } from "./embed/embeddings";
import { search as runSearch, type SearchMode, type SearchCandidate } from "./search/searchEngine";
import { formatGroundedAnswer, type CitationResult, type SearchHit } from "./citation/citationFormatter";
import { detectChunkLanguage } from "./language/multiLanguage";
import { recordAuditEvent } from "./security/auditLog";
import { TtlCache } from "./search/queryCache";

export interface KnowledgeSearchOptions {
  installationId: string;
  query: string;
  mode?: SearchMode;
  category?: string;
  language?: string;
  k?: number;
}

export type KnowledgeSearchResult = CitationResult & { tookMs: number; cached: boolean };

const QUERY_CACHE_TTL_MS = 60_000;
const queryCache = new TtlCache<CitationResult>(QUERY_CACHE_TTL_MS);

function cacheKey(options: KnowledgeSearchOptions): string {
  return JSON.stringify({
    installationId: options.installationId,
    query: options.query.trim().toLowerCase(),
    mode: options.mode ?? "hybrid",
    category: options.category ?? null,
    language: options.language ?? null,
    k: options.k ?? 5,
  });
}

/**
 * Search API logic: embeds the query, loads this installation's candidate
 * chunks (optionally category/language-filtered), runs semantic/keyword/
 * hybrid retrieval (search/searchEngine.ts), and formats a grounded,
 * cited answer or an explicit refusal (citation/citationFormatter.ts).
 * Every query is logged (SearchQueryLog) for audit, and identical repeat
 * queries within `QUERY_CACHE_TTL_MS` are served from an in-process cache
 * rather than re-embedding and re-searching from scratch.
 */
export async function performKnowledgeSearch(databaseUrl: string, options: KnowledgeSearchOptions): Promise<KnowledgeSearchResult> {
  const start = Date.now();
  const key = cacheKey(options);
  const cached = queryCache.get(key);
  if (cached) {
    return { ...cached, tookMs: Date.now() - start, cached: true };
  }

  const records = new KnowledgeRecordService(databaseUrl);
  try {
    const candidates = await records.getSearchCandidates(options.installationId, { category: options.category, language: options.language });
    const queryLanguage = detectChunkLanguage(options.query).name;

    if (candidates.length === 0) {
      const result: CitationResult = { answered: false, reason: "The knowledge base is empty for this installation — run a website scan and knowledge build first." };
      const tookMs = Date.now() - start;
      await records.logSearchQuery({ installationId: options.installationId, queryText: options.query, queryLanguage, searchMode: options.mode ?? "hybrid", resultCount: 0, topChunkIds: [], tookMs });
      return { ...result, tookMs, cached: false };
    }

    const queryVector = await embedText(options.query);
    const vectorStore = getDefaultVectorStore();
    const searchCandidates: SearchCandidate[] = candidates.map((c) => ({ chunkId: c.chunkId, content: c.content }));

    const hits = runSearch({
      vectorStore,
      namespace: options.installationId,
      queryVector,
      query: options.query,
      candidates: searchCandidates,
      k: options.k ?? 5,
      mode: options.mode ?? "hybrid",
    });

    const byId = new Map(candidates.map((c) => [c.chunkId, c]));
    const searchHits: SearchHit[] = hits
      .map((hit): SearchHit | null => {
        const chunk = byId.get(hit.chunkId);
        if (!chunk) return null;
        return {
          chunkId: chunk.chunkId,
          content: chunk.content,
          sourceUrl: chunk.sourceUrl,
          title: chunk.title,
          category: chunk.category,
          confidenceScore: chunk.confidenceScore,
          semanticScore: hit.semanticScore,
          keywordScore: hit.keywordScore,
        };
      })
      .filter((h): h is SearchHit => h !== null);

    const result = formatGroundedAnswer(searchHits);
    const tookMs = Date.now() - start;

    await records.logSearchQuery({
      installationId: options.installationId,
      queryText: options.query,
      queryLanguage,
      searchMode: options.mode ?? "hybrid",
      resultCount: result.answered ? result.sources.length : 0,
      topChunkIds: result.answered ? result.sources.map((s) => s.chunkId) : [],
      tookMs,
    });
    recordAuditEvent({ type: "search_performed", detail: `installation=${options.installationId} mode=${options.mode ?? "hybrid"} answered=${result.answered}` });

    queryCache.set(key, result);
    return { ...result, tookMs, cached: false };
  } finally {
    await records.close();
  }
}

/** Test/ops hook — the cache is a module-level singleton (one process serves one installation), so tests need a way to reset it between cases. */
export function clearSearchCache(): void {
  queryCache.clear();
}
