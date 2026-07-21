# Enterprise AI Knowledge Builder (Phase 3)

## What it does

Phase 2's scanner produces raw structured data (`CrawledPage`,
`ExtractedProduct/Service/Faq`, `ProcessedDocument`) for one crawl job.
Phase 3 reads that data and builds the AI-ready knowledge base from it:
cleaned text, semantically-aware chunks, local embeddings, a real ANN
vector index, categorization, deduplication, versioning, confidence
scoring, and a search API that cites its sources or refuses to answer
rather than guess.

**Deliberately a separate, re-runnable stage from the crawl itself** — not
fused into `scanOrchestrator.service.ts`. That's what makes three things
possible: rebuilding the knowledge base without recrawling, versioning
(each rebuild can supersede chunks without losing history), and Auto
Knowledge Update (a recrawl's incremental-change detection feeds back into
"which pages actually need re-chunking/re-embedding," not "reprocess
everything").

## Folder structure

```
backend/src/knowledge/
├── clean/
│   └── textNormalizer.ts       Unicode NFC, punctuation/number/date/URL normalization
├── chunk/
│   ├── chunker.ts               core chunking engine: chunkBlocks() / chunkText()
│   ├── sentenceSplitter.ts      abbreviation/decimal/initial-aware sentence boundaries
│   ├── codeBlockDetector.ts     fenced-code extraction + un-fenced code heuristic
│   ├── tableSerializer.ts       table rows -> Markdown table text
│   └── markdownStructureParser.ts  flat text -> headings/lists/tables/code blocks
├── embed/
│   └── embeddings.ts            local model, bounded concurrency, model/version metadata
├── vector/
│   └── vectorStore.ts           HNSW ANN index (hnswlib-node), namespaced, backup/restore
├── search/
│   ├── searchEngine.ts          semantic + BM25 keyword + Reciprocal-Rank-Fusion hybrid search
│   └── queryCache.ts            in-process TTL cache for repeated queries
├── categorize/
│   └── categoryClassifier.ts    the spec's 17-category taxonomy
├── dedup/
│   └── chunkDeduplicator.ts     exact-hash + near-duplicate (embedding) clustering, union-find merge
├── version/
│   └── versionManager.ts        chunk version history + forward-only rollback
├── update/
│   └── autoUpdateEngine.ts      turns Phase 2's recrawl plan into a chunk-level update plan
├── confidence/
│   └── confidenceScorer.ts      multi-factor confidence scoring
├── citation/
│   └── citationFormatter.ts     grounded-response formatting, refuses low-confidence answers
├── language/
│   └── multiLanguage.ts         detection incl. Hinglish; documented translation scope boundary
├── security/
│   ├── encryption.ts            AES-256-GCM using the installer's ENCRYPTION_KEY
│   ├── accessControl.ts         API key verification + per-client token-bucket rate limiting
│   └── auditLog.ts              structured audit events via the shared logger
├── knowledgeRecord.service.ts   Prisma persistence (one client per build run, Phase 2 pattern)
├── knowledgeBuilder.service.ts  top-level build orchestrator + WebSocket progress
└── knowledgeSearch.service.ts   search API logic: retrieval + citation + caching + audit
```

Every engine module above (`chunk/`, `embed/`, `vector/`, `search/`,
`categorize/`, `dedup/`, `version/`, `update/`, `confidence/`, `citation/`,
`language/`, `security/`) is Prisma-free and independently unit-tested —
`knowledgeRecord.service.ts` is the only place that touches the database,
and `knowledgeBuilder.service.ts` / `knowledgeSearch.service.ts` are the
only places that wire the engines together.

## Pipeline

```
Phase 2 crawlJobId
   │
   ▼
Load ── CrawledPage + ExtractedProduct/Service/Faq + ProcessedDocument
   │     for this crawl job, plus each page's raw ocrResults
   ▼
Structure ── build ordered content blocks (paragraph/list/table/code) from
   │          each page's stored fields and each document's extracted text
   │          — Markdown documents recover real per-section structure
   │          from their `#` headings; HTML pages and non-Markdown
   │          documents get page/document-level (not sub-heading-level)
   │          section context, since Phase 2's storage doesn't track DOM
   │          position (see "Known limitation" below)
   ▼
Chunk ── sentence-boundary sliding window (chunk/sentenceSplitter.ts);
   │      splits on section/heading boundaries first, keeps tables and
   │      code blocks whole regardless of size
   ▼
Categorize + detect language ── the 17-category taxonomy (Company/
   │      Products/Services/Pricing/FAQs/Blogs/Policies/Support/Contact/
   │      Careers/Documentation/Tutorials/Downloads/Case Studies/
   │      Portfolio/Testimonials/Announcements) and language (incl.
   │      Hinglish) per chunk
   ▼
Embed ── local model, bounded concurrency (not fused-tensor batching —
   │       see embed/embeddings.ts for why), embeddingModel +
   │       embeddingVersion recorded per chunk for staleness detection
   ▼
Deduplicate ── exact content-hash + near-duplicate (embedding similarity)
   │            clustering; duplicates are never silently dropped — every
   │            source page/document that produced the same content keeps
   │            its own chunk row (queryable), just flagged isDuplicate +
   │            pointed at the canonical chunk, which is the only copy
   │            that gets indexed
   ▼
Score ── multi-factor confidence (source authority, content quality,
   │       recency, completeness, duplicate corroboration, OCR accuracy,
   │       embedding quality) — query-time semantic match is a separate,
   │       dynamic signal combined in at search time, not baked in here
   ▼
Version ── if a chunk matching this page+section already existed (across
   │         this installation's prior builds), archive its previous
   │         content+embedding to ChunkVersion before overwriting;
   │         unchanged content is skipped entirely
   ▼
Index ── rebuild the HNSW vector index (vector/vectorStore.ts) for this
   │       installation's namespace + persist KnowledgeChunk rows
   ▼
Search API ── POST /api/knowledge/search: semantic / keyword / hybrid
              retrieval, ranked and filtered by category/language, every
              result carrying full source citation — or a refusal when
              nothing clears the confidence floor. Rate-limited, API-key
              protected, every query audit-logged, repeat queries cached.
```

## API

See [docs/API.md](API.md#phase-3--enterprise-ai-knowledge-builder-api) for
the full `POST /api/knowledge/build`, `/search`, and `/rollback` reference.

## Vector database design decision

`hnswlib-node` (a real HNSW — Hierarchical Navigable Small World — ANN
index, the same algorithm family used by most production vector databases)
runs in-process, verified for real in this environment: a live index built
and queried with genuine cosine-distance results before being adopted, and
since exercised across 5 real crawl jobs' worth of data during development.
Chosen over `pgvector` (not installable on this host without privileges
this deployment doesn't have — see `docs/SCANNER.md` §Embeddings) and over
Phase 2's original stopgap of brute-force `Float[]` cosine similarity,
which doesn't scale to "enterprise-scale, millions of documents."

**Architecture**: metadata (content, category, source, confidence, ...)
lives in Postgres (`knowledge_chunks`, queryable, filterable, transactional);
the vector index only stores `chunkId → embedding` and does ANN search,
returning candidate IDs that get joined back to Postgres for full records
and metadata filtering. A small JSON sidecar file next to each `.hnsw`
index tracks the integer-label ↔ chunkId mapping and true vector
dimensionality — required because hnswlib-node silently returns garbage
(not an error) if you reopen an index with the wrong dimension count.

**Namespace model**: one HNSW index per installation (`namespace =
installationId`), matching this product's single-tenant-per-deployment
model. Index files persist under `storage/vector-index/<namespace>.hnsw`
(+ `.labels.json`), tracked in `vector_index_meta`. `VectorStore` supports
`backup()`/`restore()` (plain file copies) and a full `rebuild()` for
re-indexing after a batch of changes or an embedding model upgrade.

**Honest scaling boundary**: HNSW gives sub-linear search — genuinely fast
at tens of thousands to low millions of vectors on a single machine. A
truly massive multi-tenant, horizontally-sharded "millions of documents
across many customers" deployment would eventually want a dedicated vector
database service (Qdrant, Milvus, pgvector-with-privileges) — this design
gets there without needing one for a single self-hosted site's knowledge
base, which is what this product actually is.

## Multi-language scope boundary (honest, not hidden)

Detection covers English, Hindi, Hinglish (romanized Hindi — a heuristic
marker-word check layered on top of Phase 2's `franc`-based detection,
checked *before* trusting franc's own read since franc can confidently
misclassify Hinglish as an unrelated language entirely, not just fall back
to "undetermined"), Urdu, Arabic, French, German, Spanish. **Live
translation is out of scope for Phase 3** — a genuinely good local
translation model is a multi-GB dependency on its own (well beyond the
~90MB embedding model), and machine-translating a knowledge base
introduces exactly the kind of "answer from content the system can't
fully vouch for" risk the "never answer from untrusted data" requirement
warns against. What's implemented instead: every chunk keeps its detected
original language as metadata, and search results can be filtered by
language — a query gets matched against content in its own language
rather than a machine-translated proxy of it.

**Known residual limitation**: very short or structurally unusual text
(nav menus, bulleted category lists, digit/currency-dominated content)
still occasionally confuses the underlying trigram detector even after
two rounds of mitigation (see "What real-world testing caught" below) —
`multiLanguage.ts` falls back to English for low-confidence or
low-letter-density unsupported-language reads, but a long, grammatically
unusual fragment (e.g. a flat list of category names with no real
sentence structure) can still occasionally misdetect at "high confidence."
This affects only navigational/boilerplate content, not real prose a
customer would ask about, in the real crawl data this was tested against.

## Known limitation: coarse section granularity for HTML/non-Markdown content

Phase 2 stores a page's headings, paragraphs, lists, and tables as
separate flat arrays (`CrawledPage.headings/paragraphs/lists/tables`), not
positionally interleaved — there's no record of "this paragraph came right
after that h2." The same is true for DOCX/PDF/XLSX document extraction.
Only Markdown documents preserve true inline structure (their `#`
headings are literally part of the extracted text), so only Markdown gets
real per-subsection chunking. For everything else, every chunk from one
page/document shares that page's title as a single, page-level `section`
value — an honest, documented simplification rather than fabricated false
nesting. One concrete consequence found during real-world testing: since
many chunks from one page can share the same `(sourceUrl, section)` key,
version-matching across rebuilds claims at most one existing chunk per new
chunk per run (see "What real-world testing caught" below) rather than
attempting a more precise but unverifiable per-chunk identity match.

## Security & performance

- **Encryption**: `security/encryption.ts` — AES-256-GCM using the
  installer's already-provisioned `ENCRYPTION_KEY` (see
  `docs/SECURITY.md`), for any Phase 3 data that warrants at-rest
  encryption. Authenticated (GCM's tag makes tampering detectable —
  `decrypt` throws rather than returning corrupted plaintext).
- **Access control**: every `/api/knowledge/*` route requires the
  installer's `API_SECRET` via an `x-api-key` header (constant-time
  compared) and is rate-limited per API key (or IP, if none is given) by a
  token-bucket limiter (`security/accessControl.ts`) — verified against a
  real running server (20-request burst allowed, 21st+ rejected with 429).
- **Audit**: every search query is persisted to `search_query_logs`
  (query text, language, mode, result count, top chunk IDs, latency), and
  every access-denied/rate-limited/rollback/removal event is logged
  through the shared structured logger via `security/auditLog.ts`.
- **Caching**: `search/queryCache.ts` — an in-process TTL cache
  (60s default) keyed by installation + normalized query + mode +
  filters, so an identical repeat query skips re-embedding and re-search
  entirely. Verified against a real running server (a cached repeat query
  returned in ~0ms vs. ~300ms for the original).
- **Performance**: embeddings use bounded concurrency (not fused-tensor
  batching, see `embed/embeddings.ts`'s docstring for the measured reason
  why), the vector index gives sub-linear ANN search, and dedup only runs
  its pairwise near-duplicate pass across distinct-content representatives
  rather than every raw chunk.

## What real-world testing caught

Every engine module has its own unit tests (218 tests across 20 files as
of this writing), but the pipeline was also run end-to-end against real
data — 5 real crawl jobs of a live demo site (books.toscrape.com) already
sitting in the development database, plus real HTTP requests against a
running server. That process caught real bugs a type-checker or a purely
synthetic-fixture test suite would not have:

- **Fused-tensor embedding batching corrupts vectors.** Calling the
  embedding pipeline with a `string[]` (multiple sequences in one forward
  pass) measurably changed the resulting vectors compared to embedding the
  same text alone — cosine similarity as low as ~0.966 for a short text
  batched next to a much longer one, even though the library's own
  mean-pooling step correctly masks padding. Fixed by using bounded
  *concurrency* over single-sequence calls instead (verified to match
  sequential results to ~1.0 cosine, with a real, measured throughput
  gain from concurrency alone).
- **BM25 on a small corpus needs stopword removal.** Without it, a query
  sharing only common English function words ("you", "for") with an
  unrelated document could outscore genuinely relevant content — IDF
  alone doesn't discount common words enough at "one site's knowledge
  base" scale. Fixed with a curated English stopword list (a documented,
  deliberate English-only scope boundary).
- **Near-duplicate threshold was miscalibrated.** An initial 0.97 cosine
  threshold assumed near-bit-identical vectors; measuring real paraphrases
  of the same information against this exact embedding model showed
  genuine paraphrases score ~0.75–0.89, while topically-related-but-
  different content scores ~0.35–0.50 — recalibrated to 0.85.
- **Hinglish detection needs to run unconditionally, not as a franc
  fallback.** franc doesn't reliably fall back to "English" or
  "undetermined" on romanized Hindi — it can confidently misclassify it as
  an unrelated language entirely (a real prompt from this project's own
  development conversation, "isko 100% kro prompt ke hisab se", read as
  Pular). Fixed by checking the curated Hinglish marker-word heuristic
  first, unconditionally, rather than gating it on franc's own output.
- **Short/low-signal chunks trigger confident language misdetection.**
  Real crawled nav-menu fragments ("- Home / - Books / - Romance") and
  price lists ("£37.97 In stock £21.87 In stock ...") were confidently
  misread by franc as Southern Sotho, Scots, Balkan Romani, Danish, and
  Slovenian — none of which are even in this product's supported-language
  list. Fixed with two targeted fallbacks: low-confidence + unsupported
  language → English, and low letter-density (digit/currency-dominated
  text) + unsupported language → English. A narrow residual case (a long,
  grammatically unusual flat list of category names) remains — see the
  multi-language scope boundary above.
- **A version-collision bug only showed up across multiple real builds.**
  Since HTML pages don't have true per-chunk section identity (see the
  "coarse section granularity" limitation above), rebuilding the knowledge
  base for a second real crawl job of an already-known site let *two*
  different new chunks match the *same* existing chunk by
  `(sourceUrl, section)`, and both tried to archive it at the same version
  number — crashing on `ChunkVersion`'s `(chunkId, version)` unique
  constraint. Only appeared when running the orchestrator against a real,
  previously-built installation with multiple crawl jobs; no unit test
  using synthetic single-run data would have hit it. Fixed by having each
  existing chunk claimed by at most one new chunk per build run.
- **A first `HierarchicalNSW.readIndex()` call with the wrong dimension
  count doesn't error — it silently returns garbage results.** Verified
  directly against `hnswlib-node` before relying on it: the JS wrapper
  trusts whatever dimensionality you pass its constructor rather than
  reading it back from the saved file. `vectorStore.ts` therefore persists
  the true dimensionality in its own sidecar JSON and always reads that
  before ever constructing the native index.
