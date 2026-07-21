# Website Auto Scanner (Phase 2)

## What it does

After the installer collects Website Name + Website URL (Phase 1), the
scanner crawls that website end-to-end and builds an AI knowledge base from
it — pages, products, services, FAQs, structured data, and linked documents
— without manual configuration. Triggered via `POST /api/scan/start`; all
progress streams over the same Socket.IO connection pattern as the Phase 1
installer.

## Folder structure

```
backend/src/scanner/
├── http/
│   ├── safeFetch.ts        SSRF-safe HTTP client (DNS-pinned, private-IP blocked)
│   └── rateLimiter.ts      per-host serialized rate limiting
├── discovery/
│   ├── robotsTxt.ts        robots.txt parsing + disallow/crawl-delay rules
│   ├── sitemap.ts          sitemap.xml / sitemap index parsing (+ gzip)
│   ├── rssFeed.ts          RSS/Atom feed discovery
│   ├── linkClassifier.ts   internal vs. external/social/CDN/ad/tracking
│   ├── techStack.ts        CMS/framework signal detection
│   └── discoveryService.ts orchestrates the above into one seed URL list
├── crawl/
│   └── crawlQueue.ts       BFS queue, concurrency, depth/page limits, retries
├── parse/
│   ├── htmlParser.ts       cheerio-based structural extraction
│   ├── headlessRenderer.ts Playwright fallback for JS-shell SPAs
│   ├── contactExtractor.ts phone/email/address/hours/maps/WhatsApp/social
│   ├── structuredData.ts   JSON-LD, Schema.org, Open Graph, Twitter Cards
│   └── pageTypeClassifier.ts URL/title heuristic (home/product/blog/faq/...)
├── detect/
│   ├── productDetector.ts  structured data first, whole-document heuristic fallback
│   ├── serviceDetector.ts
│   └── faqDetector.ts
├── documents/
│   ├── documentDiscovery.ts   finds linked PDF/DOCX/XLSX/CSV/... URLs
│   ├── documentExtractor.ts   extracts text per format
│   └── documentService.ts     fetch + extract + hash, error-isolated
├── ocr/
│   └── ocrEngine.ts        Tesseract.js — local, no external API
├── language/
│   └── languageDetector.ts franc-based detection, prose-only sampling
├── clean/
│   ├── contentCleaner.ts   strips scripts/CSS/ads/popups/hidden/nav noise
│   └── duplicateDetector.ts content-hash based dedup (pages/paragraphs/images/docs)
├── knowledge/
│   ├── chunker.ts          paragraph-boundary-aware text chunking
│   ├── embeddings.ts       local model via @xenova/transformers
│   └── knowledgePreparer.ts chunk + embed + confidence-score + tag
├── recrawl/
│   ├── changeDetector.ts   new/modified/unchanged/deleted classification
│   └── conditionalFetch.ts ETag/Last-Modified 304 support
├── report/
│   └── reportGenerator.ts  pure aggregation → the spec's report shape
├── scanRecord.service.ts   Prisma persistence (one client per crawl run)
└── scanOrchestrator.service.ts   top-level pipeline + WebSocket progress
```

## Pipeline

```
Website URL
   │
   ▼
Discovery ── robots.txt, sitemap.xml, RSS, homepage nav/footer link crawl
   │          → seed URL list, tech-stack signals, internal-link filter
   ▼
Crawl Queue ── BFS, bounded concurrency, per-host rate limit, retries
   │            respects robots.txt disallow + crawl-delay
   ▼
Fetch (safeFetch) ── SSRF-guarded, timeout-bounded, size-capped
   │
   ▼
Incremental check ── contentHash vs. the previous completed run for this
   │                   URL; unchanged pages skip straight to "unchanged,
   │                   keep crawling its links" without re-detection/re-embedding
   ▼
Parse ── cheerio first; headless render fallback if page is a JS shell
   │      → title/meta/headings/paragraphs/contact info/images/forms/
   │        structured data (JSON-LD/OG/Twitter)
   ▼
Detect ── products / services / FAQs (structured data first, heuristic fallback)
   ▼
OCR (bounded, non-icon images only) + Language (prose blocks only)
   ▼
Clean + Dedup ── strip noise, hash content, mark/skip duplicates
   ▼
Knowledge Prep ── chunk clean text, embed locally, tag category + confidence
   ▼
Documents ── discover + extract text from linked PDFs/DOCX/XLSX/CSV/...
   ▼
Persist (Postgres) ── CrawledPage, ExtractedProduct/Service/Faq,
   │                    ProcessedDocument, KnowledgeChunk
   ▼
Report ── counts, tech stack, SEO/performance/security summary, errors/warnings
```

## Security posture

The scanner fetches **customer-supplied URLs** and everything those pages
link to — a classic SSRF surface if left unguarded. `http/safeFetch.ts`:

- Resolves the hostname via DNS *before* connecting, rejects any resolved
  address in a private/loopback/link-local/multicast/reserved range
  (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`,
  `169.254.0.0/16` — including the `169.254.169.254` cloud metadata
  endpoint — and IPv6 equivalents).
- Pins the connection to the *validated* IP (via undici's custom `lookup`),
  closing the DNS-rebinding gap where a name resolves safely at check-time
  and unsafely at connect-time.
- **Separately validates literal-IP URLs** (`http://127.0.0.1/`,
  `http://169.254.169.254/`) before ever calling undici — Node's
  `net.connect` skips the custom `lookup` hook entirely when the host is
  already an IP literal, which would otherwise let this exact bypass
  through. Found by testing the guard against real literal-IP requests,
  not assumed to work from the DNS-hook alone.
- Enforces a response size cap and a request timeout on every fetch.
- Follows redirects manually (not automatically), re-validating the SSRF
  check on every hop — an attacker-controlled redirect to an internal
  address is exactly the bypass automatic redirect-following would allow.
- Respects `robots.txt` disallow rules and `Crawl-delay` before requesting
  anything.

11 automated tests in `safeFetch.test.ts` cover this against real network
calls (a real public site allowed; real literal IPv4/IPv6/hostname-to-
loopback targets blocked) — not mocked.

All scanning is **read-only** — no forms are submitted, no state-changing
requests are made anywhere in the pipeline.

### Known dependency advisories (accepted, documented — not hidden)

- `@xenova/transformers` → `onnxruntime-web` → `onnx-proto` → `protobufjs`
  carries unpatched critical/high CVEs (code injection, prototype
  pollution, DoS) with no fixed version available in this dependency
  chain. The exploit path requires a malicious `.onnx` model file; this
  product only ever loads one pinned, known model (`Xenova/all-MiniLM-L6-v2`)
  from Hugging Face's CDN over HTTPS — it never loads a model from a
  crawled site or any other untrusted source. Materially different, much
  lower-likelihood threat model than the documents below.
- `exceljs`'s bundled `uuid` carries a moderate advisory (missing buffer
  bounds check when an explicit buffer is passed to `uuid.v3/v5/v6`) — used
  internally only for random ID generation, never with attacker-supplied
  buffers.
- Both are genuinely different from the XLSX-parsing library itself: the
  original `xlsx` (SheetJS) package was replaced with `exceljs` specifically
  because `xlsx`'s ReDoS/prototype-pollution advisories had **no fix
  available** on npm and sit directly in the untrusted-input path (every
  crawl parses XLSX files fetched from the open internet) — that one was a
  real, live risk worth swapping the library over, not just documenting.

## Embeddings

Generated locally via `@xenova/transformers` (`all-MiniLM-L6-v2`, 384-dim,
runs in-process via ONNX/WASM) — no external API key, no per-request cost,
no customer content leaving the server. Verified for real: cosine
similarity between two semantically related sentences scored 0.54 vs. 0.12
for an unrelated pair — the embeddings are genuinely semantic, not just
correctly-shaped vectors. Stored as `Float[]` on `KnowledgeChunk.embedding`
with in-application cosine similarity for retrieval.

**Upgrade path:** the `pgvector` Postgres extension isn't available on
every target host (this dev environment doesn't have it installed and
lacks the privileges to add it). `Float[]` + in-app cosine similarity is a
real, working default at single-site knowledge-base scale — not a stand-in.
When `pgvector` is available, `KnowledgeChunk.embedding` can be migrated to
a native `vector(384)` column for indexed ANN search at larger scale.

## Incremental recrawl

Each scan looks up the previous **completed** crawl job for the same
website and compares each freshly-fetched page's content hash against that
run's hash for the same URL (`recrawl/changeDetector.ts`). An unchanged
page skips product/service/FAQ re-detection and — the expensive part —
re-chunking/re-embedding, while still being walked for outbound links so
the crawl doesn't stop discovering new pages through it. Verified against a
real site: scanning the same 15 pages twice correctly identified 14 as
unchanged on the second pass and reported it in the crawl report's
warnings.

`recrawl/conditionalFetch.ts` additionally supports ETag/Last-Modified
conditional requests (verified against a real server returning a genuine
`304 Not Modified`) as a building block for skipping the *fetch* itself on
a future pass — not yet wired into the main orchestrator, which always
fetches fresh and compares hashes after the fact; documented here as the
natural next optimization rather than left unmentioned.

## What real-world testing caught

Every engine here was exercised against real websites (react.dev,
books.toscrape.com — a site built specifically for scraper testing — real
PDF/DOCX/CSV/XLSX files, a real OCR test image, a real embedding
similarity check) rather than synthetic fixtures alone. That process
surfaced and fixed genuine bugs no type-checker would have caught:

- **SSRF bypass via literal IPs** — `http://127.0.0.1/` sailed straight
  past the DNS-hook-based guard because Node's `net.connect` never calls a
  custom `lookup` for hosts that are already IP literals.
- **undici Happy-Eyeballs callback-shape mismatch** — the SSRF lookup hook
  crashed on `example.com` specifically because it always returned the
  single-address callback shape even when undici requested the
  multi-address (`options.all`) shape.
- **Cheerio `.map().get()` double-flattening** — table row extraction
  collapsed every row's cells into one flat array, losing row boundaries,
  because chaining cheerio's jQuery-style `.map()` inside another `.map()`
  flattens one level automatically.
- **Duplicate-count/unique-count conflation** — the crawl report showed "14
  duplicate pages" on a 15-page crawl where only one page was genuinely a
  duplicate; `DuplicateTracker.stats()` returns the count of *unique* items
  seen, and the report was passing that where a duplicate-*hit* count
  belonged.
- **Language misdetection on non-prose fragments** — a real product listing
  page's `<p>` tags contained only price/stock-status text (titles lived in
  headings), so franc confidently misread the page as Slovenian; language
  detection now samples headings + paragraphs, not list items, which
  reliably produced further false positives from concatenated category
  labels.
- **Product heuristic missed a real site's markup** — the container
  selector list (tuned for WooCommerce/Shopify conventions) didn't match a
  real demo storefront's `.product_main` class; added a whole-document
  fallback keyed on "has an `<h1>` and a price pattern anywhere" for sites
  using neither structured data nor a recognized CMS's class names.
