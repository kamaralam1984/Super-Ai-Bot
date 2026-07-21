# Enterprise AI Training Engine (Phase 6)

## What it does

Phase 3 already turns a crawl into an AI-ready knowledge base — chunking,
17-category classification, local embeddings, a real HNSW vector index,
dedup, and confidence scoring. Phase 6 doesn't rebuild any of that. It
adds what Phase 3 genuinely doesn't do: a semantic knowledge graph linking
products, services, FAQs, policies, blog posts, and contacts to each
other; deeper structured learning for products (benefits, availability,
related products), services (dependencies, related services), and FAQs
(per-FAQ confidence, similar/related questions, real duplicate merging —
not just flagging); brand-new structured extraction for contacts and
policy sub-types (neither existed as a queryable model before); an
explicit pre-flight validation stage; true incremental training (only
reprocessing changed content, not a full rebuild every time); a post-hoc
quality-integrity check; and a persisted training report.

**Before writing a line of this phase, the codebase was audited against
the full spec to find out what already existed.** Chunking, embedding,
vector indexing, 17-category classification, confidence scoring, and
forward-only versioning/rollback are all production-built in Phase 3 and
are reused here as-is, not reimplemented. See "Known limitations" for the
honest boundary of what's genuinely new versus what's Phase 3 wearing a
Phase 6 label.

## Folder structure

```
backend/src/training/
├── types.ts                        shared draft/relationship/report contracts
├── extract/
│   ├── contactExtractor.ts         normalizes Phase 2's raw contactInfo blob into a structured draft
│   ├── policyExtractor.ts          classifies a "Policies" chunk into its specific sub-type
│   ├── productLearning.ts          availability normalization, benefit extraction, related-product ranking
│   ├── serviceLearning.ts          dependency extraction, related-service ranking
│   └── faqLearning.ts              per-FAQ confidence, similar/related questions, real duplicate-cluster merging
├── relationships/
│   └── relationshipEngine.ts       the knowledge graph — name-mention + embedding-similarity linking, plus deterministic edges
├── validate/
│   └── knowledgeValidator.ts       pre-chunking "Validate Knowledge" stage (empty/garbage/repetitive content)
├── incremental/
│   └── incrementalTrainer.ts       wires Phase 2/3's already-built (but previously unused) change-detection functions into a real incremental plan
├── quality/
│   └── qualityValidator.ts         post-training integrity check over the persisted knowledge base + graph
├── report/
│   └── trainingReportGenerator.ts  assembles the final TrainingReportData
├── retrain/
│   └── retrainScheduler.ts         manual/scheduled/automatic retraining triggers
├── trainingRecord.service.ts       Prisma persistence (only module that touches the database)
└── trainingOrchestrator.service.ts top-level pipeline + WebSocket progress
```

Every module except `trainingRecord.service.ts` is Prisma-free; every
module except `relationshipEngine.ts`/`productLearning.ts`/
`serviceLearning.ts`/`faqLearning.ts` (which call the embedding model's
`cosineSimilarity` on already-computed vectors, never re-embedding
anything themselves) is also free of any model/network calls — the same
"pure engine + one record service + one orchestrator" discipline every
prior phase established.

## Pipeline

```
Phase 2 crawlJobId
   │
   ▼
Plan ── incremental/incrementalTrainer.ts diffs this crawl job's pages
   │      against the last COMPLETED crawl job for the same installation
   │      + website (reusing Phase 2's planIncrementalRecrawl) and decides
   │      which URLs actually need reprocessing (reusing Phase 3's
   │      previously-orphaned autoUpdateEngine.ts functions) — a full
   │      build on the very first run, incremental on every run after
   ▼
Validate ── validate/knowledgeValidator.ts runs an explicit pre-chunking
   │          pass over raw page text: empty content, broken encoding,
   │          scraping-artifact repetition — flagged in the training
   │          report, doesn't block the build (Phase 3's chunker already
   │          copes with imperfect input; this is diagnostic, not a gate)
   ▼
Build ── Phase 3's runKnowledgeBuild(), extended (backward-compatibly —
   │       every existing caller that omits the new parameter is
   │       unaffected) with the incremental plan: only new/modified URLs
   │       are (re-)chunked/embedded/scored; the vector index step does a
   │       targeted upsert/remove instead of a full rebuild when running
   │       incrementally
   ▼
Extract ── contactExtractor.ts + policyExtractor.ts turn Phase 2's raw
   │         contact blob and Phase 3's "Policies"-categorized chunks into
   │         structured ExtractedContact/ExtractedPolicy rows
   ▼
Enrich ── productLearning.ts / serviceLearning.ts / faqLearning.ts compute
   │        benefits/availability/dependencies/confidence/related-entity
   │        rankings from one batch embedding call per entity type, and
   │        consolidate real FAQ duplicate clusters (picking the best
   │        canonical, not whichever Phase 3 happened to pick first)
   ▼
Relationships ── relationshipEngine.ts builds the graph: deterministic
   │               edges (a product's own category, a service's own
   │               industries) plus inferred edges (name-mention and/or
   │               embedding-similarity linking FAQs↔products/services,
   │               policies↔services, blog posts↔products, and
   │               same-page company↔contact co-location)
   ▼
Quality check ── quality/qualityValidator.ts checks the now-persisted
   │               knowledge base + graph for integrity: empty chunks,
   │               invalid/out-of-range confidence, dangling
   │               duplicate/relationship references
   ▼
Report ── report/trainingReportGenerator.ts assembles counts + category
            breakdown + overall confidence + every validation/quality
            issue into one TrainingReportData row, persisted via
            trainingRecord.service.ts; trainingOrchestrator.service.ts
            streams `training:progress` throughout
```

## The knowledge relationship graph

`KnowledgeRelationship` is deliberately polymorphic (`sourceType`/
`sourceId`/`targetType`/`targetId` plain strings, not per-entity-type
foreign keys) since one table needs to connect six structurally different
entity kinds and a bare category-name string — Prisma has no native
polymorphic-relation support, and six nullable FK columns per row would
buy nothing since edges are read by `(sourceType, sourceId)` lookup, not
Prisma relation traversal.

Two kinds of edges:
- **Deterministic** (confidence 1.0, no inference): a product's own
  category, a service's own industries, a company chunk co-located with a
  contact on the same page.
- **Inferred**: an explicit name mention in the source text (strong
  evidence, floored at 0.85 confidence) and/or embedding cosine similarity
  above a threshold (weaker standalone evidence, scored at the raw
  similarity value). Both signals combine when both fire.

## Known limitations (honest, not hidden)

- **FAQ deduplication only ever runs within one crawl job's FAQs**, not
  across the whole installation's accumulated history — a near-duplicate
  FAQ introduced in a later crawl of a different page won't be merged
  against one from an earlier crawl unless both happen to land in the
  same `runKnowledgeBuild` call. Cross-crawl-job FAQ consolidation is a
  documented gap, not silently broken behavior.
- **Incremental filtering does not extend to FAQs.** The incremental plan
  restricts which *pages/documents* get re-chunked/re-embedded, but
  `data.faqs` (Phase 3's own load) still processes every FAQ belonging to
  the crawl job on every run — a deliberate, minimal-blast-radius scope
  boundary (FAQs are typically a small fraction of total content) rather
  than a deeper, riskier change to Phase 3's FAQ-loading path.
- **Policy/blog/company linkage relies on Phase 3's chunk categorization
  being correct** — this module doesn't re-derive "is this really a
  policy/blog/company page," it trusts `categoryClassifier.ts`'s existing
  judgment and only adds sub-type detail (which specific policy) or
  builds graph edges on top.
- **Branch/department inference in contact extraction is a narrow keyword
  heuristic** (see `contactExtractor.ts`) — it recognizes conventional
  patterns like "Mumbai Office" or "Contact Us - Bangalore" in a page's
  title, not any location name in any phrasing. Left `null` rather than
  guessed when it doesn't recognize the pattern.
- **No concurrent-run guard.** Like every other phase's orchestrator in
  this codebase, nothing prevents two training runs for the same
  installation from executing at once — running one manually while a
  scheduled retrain also fires can interleave writes. This is consistent
  with the existing pattern app-wide (no phase implements this), not a
  regression introduced here; see "What real-world testing caught" for
  how this was discovered and why the underlying data-integrity bug it
  exposed (not the concurrency itself) was fixed.
- **Scheduled retraining is in-process and does not survive a server
  restart** (`retrain/retrainScheduler.ts`) — consistent with this
  product's single-long-running-process-per-installation deployment
  model; there is no durable job queue anywhere in this codebase to
  persist a schedule across restarts.
- **"Conversation Context" (from the spec's "AI Memory" section) is out of
  scope**, for the same reason it's out of scope for every prior phase:
  the chatbot's actual conversation layer doesn't exist yet (see the
  README's standing disclaimer). "Knowledge Versioning," "Snapshots,"
  "Rollback," and "History" are covered by Phase 3's existing
  `ChunkVersion`/rollback machinery plus this phase's `TrainingReport`
  history (`GET /api/training/reports`) — not rebuilt a second time.

## Security posture

- Read-only knowledge processing: every module in `training/` only reads
  already-extracted, already-persisted content — nothing in this phase
  makes an outbound network request or touches a customer's live system.
- Every route requires the same `x-api-key` + per-caller rate limiting as
  every other authenticated API in this product.
- Structured audit events (`training_retrain_requested`,
  `training_schedule_created`, `training_schedule_cancelled`) extend the
  same file-based audit trail (`auditLog.ts`) every other phase's security
  events go through.
- Encrypted storage, permission validation, and secure metadata are
  inherited as-is from Phase 3's existing security layer
  (`encryption.ts`, `accessControl.ts`) — this phase introduces no new
  credential or secret-handling surface of its own.

## API

See [docs/API.md](API.md#phase-6--enterprise-ai-training-engine-api) for
the full route reference.

## What real-world testing caught

Every pure engine module has synthetic-fixture unit tests, but the full
pipeline was also run end-to-end against real infrastructure — a real
crawl of a live website (books.toscrape.com, via Phase 2's actual scanner)
pushed through Phase 3's actual knowledge build and this phase's actual
training pipeline, plus a hand-authored but realistic second dataset
(products, services, FAQs, contact/policy/blog pages) specifically
designed to exercise every content type this phase adds — run against the
real local embedding model and a real Postgres database, not mocks. That
process caught two genuine, previously-hidden bugs:

- **Phase 3's FAQ deduplication near-duplicate pass was silently dead
  code.** `knowledgeBuilder.service.ts` called `deduplicateFaqs(...)`
  without ever populating each FAQ's `embedding` field.
  `chunkDeduplicator.ts`'s core `deduplicate()` filters candidates for its
  embedding-similarity pass down to `items.filter(item => item.embedding)`
  — since no caller ever set it, that filter always produced an empty
  list, meaning only *byte-for-byte-identical* FAQs (caught by the
  separate exact-content-hash pass) were ever flagged as duplicates; any
  near-duplicate paraphrase — the actual, common case a real FAQ page
  produces — silently passed through unflagged, with zero error or
  warning anywhere. This existed in Phase 3, unnoticed, because Phase 3's
  own unit tests call `deduplicateFaqs` directly with embeddings already
  attached (correctly testing the pure function in isolation) — nothing
  had exercised the *orchestrator's own wiring* end-to-end with genuinely
  near-duplicate (not identical) FAQ content before this phase's testing
  did. Fixed by embedding every FAQ's `question\nanswer` text before
  calling `deduplicateFaqs`, in `knowledgeBuilder.service.ts`.
- **When Phase 6's canonical-reselection (`planFaqMerges`, which prefers a
  `structured_data`-sourced FAQ over Phase 3's plain "longest content
  wins" rule) picked a different canonical than Phase 3's own initial
  pass had, the newly-chosen canonical could be left permanently
  mis-flagged as `isDuplicate: true`.** Phase 3's dedup, running first,
  may have already marked that same FAQ as a duplicate of a *different*
  cluster member; `applyFaqMerge` only ever updates the *merged-away* rows
  it's explicitly told about, never the canonical it's merging *into* — so
  a canonical that had previously been a non-canonical member of Phase
  3's own clustering kept its stale duplicate flag. The practical effect:
  the single best, most complete, most trustworthy FAQ in a cluster could
  end up excluded from every duplicate-filtered view (search results, the
  AI tool layer) while a lower-quality member stood in as "canonical"
  instead. Caught by inspecting the *actual persisted state* after a real
  training run rather than only checking the API response — the training
  report itself reported success with no errors, since nothing about this
  was exceptional or logged. Fixed by adding
  `TrainingRecordService.setFaqCanonical()`, called for every
  newly-chosen canonical to explicitly clear its own duplicate flags, and
  by updating the in-memory `faqEntities` snapshot the enrichment loop
  reads from so it reflects Phase 6's final merge decision rather than
  Phase 3's superseded one. Verified with a clean, isolated re-run
  afterward: the canonical correctly ended up `isDuplicate: false` with a
  real confidence score and both duplicates correctly consolidated into
  its `mergedFaqIds`.

A third thing surfaced during this same testing process but turned out
*not* to be a Phase 6 bug: an early test run showed a canonical FAQ with
dangling references to FAQ IDs that had already been deleted. Investigation
traced this to two overlapping training runs (a manual API call plus a
directly-invoked test run) racing against the same installation — a real,
reproducible characteristic given this phase's documented lack of a
concurrent-run guard (see "Known limitations"), not a data-corruption bug
in the merge logic itself. Re-run in isolation, the same scenario produced
fully consistent results, confirming the underlying logic was sound once
the two genuine bugs above were fixed.
