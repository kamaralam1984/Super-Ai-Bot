# KVL Super AI Chatbot

A self-hosted enterprise product for the KVL Super AI Chatbot. This is
**not** a SaaS platform — everything here runs on the customer's own
VPS/dedicated server/local Linux machine.

- **Phase 1 — Installer**: a wizard that checks requirements, validates the
  customer's website, generates configuration and security keys, provisions
  the database, and lays out the runtime directory structure. The customer
  provides exactly two things: **Website Name** and **Website URL**.
  Everything else — secrets, database, directories, migrations — is
  automated.
- **Phase 2 — Website Auto Scanner**: after install, automatically crawls
  that website and builds an AI knowledge base from it — pages, products,
  services, FAQs, structured data, and linked documents (PDF/DOCX/XLSX/CSV)
  — with no manual configuration. See [docs/SCANNER.md](docs/SCANNER.md).
- **Phase 3 — Enterprise AI Knowledge Builder**: turns Phase 2's raw
  scanned data into an AI-ready knowledge base — semantic chunking, local
  embeddings, a real HNSW vector index, 17-category classification,
  duplicate detection, versioning/rollback, multi-factor confidence
  scoring, and a search API that cites its sources or refuses to answer
  rather than guess. See
  [docs/KNOWLEDGE_BUILDER.md](docs/KNOWLEDGE_BUILDER.md).
- **Phase 4 — Enterprise Smart Technology Detection Engine**: after a
  scan, automatically identifies the target site's technology stack
  across 16 categories (CMS, frontend/backend frameworks, hosting,
  server, CDN, database, JS libraries, SEO tools, analytics, payment
  gateways, authentication, live chat, forms) with a calibrated
  confidence score per finding, plus a security/performance analysis and
  Smart Connector Engine compatibility notes — never a single-signal
  guess, always read-only. See
  [docs/TECH_DETECTION.md](docs/TECH_DETECTION.md).
- **Phase 5 — KVL Smart Connector Engine**: connects the chatbot to the
  customer's own website/CMS/enterprise system using Phase 4's technology
  report — recommends and configures the right connector (WordPress,
  WooCommerce, Shopify, Magento, OpenCart, PrestaShop, Laravel, a generic
  REST/OpenAPI connector for other frameworks, a Universal REST fallback
  for enterprise systems, a GraphQL connector with introspection-based
  discovery), encrypts and stores credentials, discovers and validates the
  API surface, monitors connection health with automatic reconnection, and
  exposes a permission-checked set of AI tools — always read-only by
  construction, never by convention. See
  [docs/SMART_CONNECTOR.md](docs/SMART_CONNECTOR.md).
- **Phase 6 — Enterprise AI Training Engine**: builds on Phase 3's
  knowledge base rather than duplicating it — adds a semantic knowledge
  graph linking products, services, FAQs, policies, blog posts, and
  contacts to each other; deeper product/service/FAQ learning (benefits,
  availability, dependencies, related-entity ranking, real FAQ duplicate
  merging); brand-new structured extraction for contacts and policy
  sub-types; an explicit pre-flight validation stage; true incremental
  training (only reprocessing what actually changed, not a full rebuild
  every time); a post-training integrity check; and a persisted training
  report. See
  [docs/AI_TRAINING_ENGINE.md](docs/AI_TRAINING_ENGINE.md).

## Quick start (development)

Requirements: Node.js ≥ 20, PostgreSQL, Redis, Git. Docker is optional (see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

```bash
npm install
cp .env.example .env
# Set DATABASE_ADMIN_URL in .env if not running as root (see below)
npm run build --workspace=shared
npm run dev:backend    # installer server on :4500
npm run dev:frontend   # wizard UI on :5173 (proxies /api and /socket.io to :4500)
```

Open the frontend dev URL in a browser and walk through the wizard. In
production, `npm run build` produces a static frontend bundle that the
backend serves directly from a single port (see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

### Database admin access

Step 6 (Database Initialization) needs to `CREATE ROLE` / `CREATE DATABASE`.
On a real VPS install running the installer as `root`, this happens via
`sudo -u postgres psql` and needs no stored credential. In non-root
environments (e.g. local development), set `DATABASE_ADMIN_URL` in `.env` to
a Postgres superuser connection string.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture, module map, folder structure
- [docs/API.md](docs/API.md) — REST + WebSocket API reference (both phases)
- [docs/DATABASE.md](docs/DATABASE.md) — schema, indexes, constraints (both phases)
- [docs/SECURITY.md](docs/SECURITY.md) — secret generation, storage, and audit trail design
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deployment, testing, rollback, and performance notes
- [docs/SCANNER.md](docs/SCANNER.md) — Phase 2 crawler/knowledge-base architecture, SSRF security design, real-world testing findings
- [docs/KNOWLEDGE_BUILDER.md](docs/KNOWLEDGE_BUILDER.md) — Phase 3 chunking/embedding/vector-search/citation architecture, security design, real-world testing findings
- [docs/TECH_DETECTION.md](docs/TECH_DETECTION.md) — Phase 4 technology detection architecture, confidence-scoring design, security posture, real-world testing findings
- [docs/SMART_CONNECTOR.md](docs/SMART_CONNECTOR.md) — Phase 5 connector architecture, read-only enforcement design, AI tool layer, real-world testing findings
- [docs/AI_TRAINING_ENGINE.md](docs/AI_TRAINING_ENGINE.md) — Phase 6 training pipeline, knowledge relationship graph design, honest scope boundaries, real-world testing findings

## Project status

**Phase 1** (the installer) is implemented and end-to-end tested: system
requirement checks, environment detection, website validation, configuration
and security key generation, PostgreSQL provisioning via Prisma migrations,
directory structure creation, a real-time WebSocket progress engine, error
recovery with automatic rollback, and a persisted installation/audit trail.

**Phase 2** (the website auto scanner) is implemented and tested against
real websites (not synthetic fixtures alone): SSRF-guarded crawling with
robots.txt/sitemap discovery, CMS/framework detection, structured-data and
heuristic product/service/FAQ extraction, PDF/DOCX/XLSX/CSV/XML/JSON
document processing, local OCR and language detection, content dedup, local
semantic embeddings for a knowledge base, incremental recrawl with change
detection, and a crawl report — all wired through one orchestrator with
real-time progress. 121 automated tests; the real-website testing process
itself caught and fixed 5 genuine bugs no type-checker would have (SSRF
literal-IP bypass, a callback-shape crash, a data-corrupting cheerio
flattening bug, a metrics conflation bug, and a language-detection false
positive) — see [docs/SCANNER.md](docs/SCANNER.md#what-real-world-testing-caught).

**Phase 3** (the enterprise AI knowledge builder) is implemented and tested
against real data — not just synthetic fixtures: the full pipeline (clean →
chunk → categorize → detect language → embed → deduplicate → score →
version → index → search) was run end-to-end against 5 real crawl jobs of
a live demo site already sitting in the development database, plus real
HTTP requests against a running server (API-key auth, rate limiting,
query caching, rollback). 218 automated tests across the 12 independently-
tested engine modules (341 total across all three phases); the real-world
testing process caught and fixed 7 genuine bugs — a fused-tensor embedding
batching correctness bug, a BM25 small-corpus stopword gap, a miscalibrated
near-duplicate threshold, two rounds of language-misdetection false
positives (Hinglish, then short/low-signal chunks), a version-collision
bug that only appeared across multiple real rebuilds, and a silent-garbage
risk in the vector index's dimension handling — see
[docs/KNOWLEDGE_BUILDER.md](docs/KNOWLEDGE_BUILDER.md#what-real-world-testing-caught).

**Phase 4** (the enterprise smart technology detection engine) is
implemented and tested against real, diverse live websites deliberately
chosen beyond the sites each detector was originally written against
(Shopify, Stripe, GitHub, W3Schools, a live Wikipedia article, every
major frontend framework's own site, PyPI, Vercel, Netlify, and more).
242 automated tests across signal collection, 16 detection categories,
security/performance analysis, confidence scoring, and report generation
(583 total across all four phases); the real-world testing process caught
and fixed 7 genuine bugs — a bare-filename regex matching prose that
merely *discusses* a technology rather than an actual script reference
(found on a live Wikipedia article), a well-known-path signal cascading
false positives on platforms with permissive URL routing (found on
GitHub), a low-confidence CMS false positive cascading into a confident-
looking database guess, a generic DNS-provider pattern misattributed to
one specific platform, a disabled-but-present HSTS header
(`max-age=0`) read as active, and a response-compression negotiation/
decompression gap in the underlying HTTP client — see
[docs/TECH_DETECTION.md](docs/TECH_DETECTION.md#what-real-world-testing-caught).

**Phase 5** (the KVL Smart Connector Engine) is implemented and tested
against real, live public infrastructure — a real Shopify store
(`allbirds.com`), a real WordPress site's REST API, the reference Swagger
Petstore OpenAPI server, and a real public GraphQL API — not mocks. 117
automated tests across the credential vault, authentication manager,
read-only HTTP client, circuit breaker, discovery/validation/health/
reconnection engines, recommendation engine, and report generator (700
total across all five phases); the real-world testing process caught and
fixed 3 genuine bugs — discovery and validation silently self-rate-limited
mid-scan, making real endpoints (including a public, unauthenticated
Shopify endpoint) intermittently vanish from the report with no trace; the
circuit breaker was a single instance shared across every connector in the
process, discarding each connector's own configured failure threshold; and
the universal OpenAPI probe list missed the common "API mounted under a
version prefix" convention, caught by probing an independent reference
implementation — see
[docs/SMART_CONNECTOR.md](docs/SMART_CONNECTOR.md#what-real-world-testing-caught).

**Phase 6** (the enterprise AI training engine) is implemented and tested
end-to-end against real infrastructure — a real crawl of a live website
(books.toscrape.com, via Phase 2's actual scanner) pushed through Phase
3's actual knowledge build and this phase's actual training pipeline,
plus a hand-authored but realistic second dataset built specifically to
exercise every content type this phase adds (products, services, FAQs,
contacts, policies, a blog post), run against the real local embedding
model and a real Postgres database. 126 automated tests across the
knowledge relationship engine, product/service/FAQ learning engines,
contact/policy extraction, the validation and quality-check stages, the
incremental-training planner, and the retrain scheduler (826 total across
all six phases); the real-world testing process caught and fixed 2
genuine bugs, both in FAQ deduplication — Phase 3's near-duplicate FAQ
matching turned out to be silently dead code (the orchestrator never
populated the `embedding` field the similarity pass filters on, so only
byte-for-byte-identical FAQs were ever caught, undetected until this
phase's testing ran genuinely near-duplicate — not identical — FAQ
content through it for the first time), and Phase 6's own canonical
reselection could leave the best FAQ in a duplicate cluster permanently
mis-flagged as a duplicate when it picked a different canonical than
Phase 3's initial pass had — see
[docs/AI_TRAINING_ENGINE.md](docs/AI_TRAINING_ENGINE.md#what-real-world-testing-caught).

The product's actual chatbot application layer (the thing this installer
sets up *for*, and the thing that queries the knowledge base Phases 2–3
and 6 build, informed by the technology profile Phase 4 produces and
connects to live via Phase 5) is out of scope for Phases 1–6 — the
installer's Completion screen "Open Dashboard" action reflects that
honestly rather than linking to a page that doesn't
exist yet.
# Super-Ai-Bot
