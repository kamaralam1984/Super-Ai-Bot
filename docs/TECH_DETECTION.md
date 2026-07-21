# Enterprise Smart Technology Detection Engine (Phase 4)

## What it does

Phase 2's scanner already crawls a site and stores its pages. Phase 4 reads
that data (plus a small number of fresh, read-only signal probes — HTTP
headers, robots.txt, well-known paths, a TLS handshake, DNS nameservers)
and identifies the site's technology stack across 16 categories: CMS,
frontend framework, backend framework, programming language, hosting
provider, server software, CDN, database (inferred only), JS libraries,
CSS framework, SEO tools, analytics, payment gateways, authentication,
live chat, and forms — then scores the site's security and performance
posture and produces one structured report for the (future) Smart
Connector Engine to consume.

**Deliberately a separate, re-runnable stage from the crawl itself** — not
fused into `scanOrchestrator.service.ts`, and not a replacement for Phase
2's existing lightweight `detectTechStack()` (`scanner/discovery/techStack.ts`,
a single-pass homepage heuristic already embedded in `CrawlJob.techStack`).
That function stays exactly as it is — Phase 4 is a much deeper, optional,
independently-runnable analysis pass over the same crawl job, the same
relationship Phase 3 (knowledge builder) has to Phase 2.

**Read-only, always.** Every signal this engine gathers is either already
sitting in the database from Phase 2's crawl, or a passive HTTP
GET/HEAD/TLS-handshake against a small, fixed set of well-known paths
(`/robots.txt`, `/wp-json/`, `/.well-known/*`, ...). It never attempts
login, never sends non-idempotent requests, never probes for
vulnerabilities, and respects `robots.txt` for every probe path exactly
like Phase 2's crawler does.

## Folder structure

```
backend/src/techdetect/
├── types.ts                      shared SiteSignals / DetectionCandidate / ScoredCandidate contracts
├── signals/
│   └── signalCollector.ts        gathers every raw signal once per site — the only place that makes network calls
├── detect/
│   ├── signalUtils.ts             shared CandidateBuilder + haystack helpers every detector below is built on
│   ├── cmsDetector.ts             CMS platform detection (14 platforms)
│   ├── frontendDetector.ts        frontend framework detection (10 frameworks)
│   ├── backendDetector.ts         backend framework + programming language inference
│   ├── hostingDetector.ts         hosting provider + server software + CDN detection
│   ├── databaseInference.ts       indirect database technology inference — never probed directly
│   ├── libraryDetector.ts         JS libraries + CSS framework detection
│   ├── seoDetector.ts             SEO tooling detection
│   ├── analyticsDetector.ts       analytics/tracking detection
│   ├── paymentDetector.ts         payment gateway detection
│   └── interactionDetector.ts     authentication + live chat + forms detection
├── security/
│   └── securityAnalyzer.ts        HTTPS/TLS/security-header analysis + 0-100 security score
├── performance/
│   └── performanceAnalyzer.ts     lazy-load/compression/caching/minification analysis + 0-100 performance score
├── confidence/
│   └── confidenceEngine.ts        turns every detector's raw SignalMatch[] into calibrated ScoredCandidate[]
├── report/
│   └── reportGenerator.ts         assembles every detector's output into the final TechnologyReport + recommendations
├── techDetectRecord.service.ts    Prisma persistence (one client per run, Phase 2/3 pattern)
└── techDetectOrchestrator.service.ts   top-level pipeline + WebSocket progress
```

Every module under `detect/`, `security/`, `performance/`, and
`confidence/` is pure and Prisma-free — each takes a `SiteSignals` object
(or a `DetectionCandidate[]`) and returns data, making no network or
database calls of its own. `signalCollector.ts` is the *only* place that
touches the network; `techDetectRecord.service.ts` is the *only* place
that touches Prisma. This mirrors Phase 3's engine-module discipline
exactly and for the same reason: every category is independently unit-
testable against a plain object literal, with no mocking required.

## Pipeline

```
Phase 2 crawlJobId
   │
   ▼
Collect signals ── one homepage fetch (safeFetch, reused from Phase 2),
   │                 robots.txt (fetchRobotsTxt, reused), a bounded set of
   │                 well-known path probes, a TLS handshake (probeTls,
   │                 reused from Phase 1), DNS nameserver lookup, plus
   │                 whatever Phase 2 already parsed for this crawl job
   │                 (structuredData, headings) — see signals/signalCollector.ts
   ▼
Detect (independent, synchronous) ── the 10 detect/ files (16 exported
   │      detection functions — some files cover more than one category,
   │      e.g. hostingDetector.ts exports hosting/server/CDN) each read the
   │      same SiteSignals and return DetectionCandidate[]: raw signal
   │      matches, no confidence math, no I/O of their own
   ▼
Score confidence ── confidence/confidenceEngine.ts combines every
   │                  candidate's matched signals into one calibrated
   │                  confidence in [0,1] via noisy-OR combination (see
   │                  below), sorted best-first. Database inference runs
   │                  after CMS/backend are scored, not alongside the
   │                  other detectors — it only trusts a *confident*
   │                  CMS/backend match as grounds for "conventionally
   │                  runs on X database" (see "What real-world testing
   │                  caught" below for why)
   ▼
Analyze security + performance ── independent of the category detectors;
   │                                produces its own findings + 0-100 scores
   ▼
Generate report ── report/reportGenerator.ts assembles every category's
   │                 scored candidates + security/performance scores into
   │                 one TechnologyReport, computes overall confidence,
   │                 recommendations, and Smart Connector Engine
   │                 compatibility notes
   ▼
Persist + stream progress ── techDetectRecord.service.ts writes one
                               TechDetectionReport row (one-to-one with
                               the CrawlJob); techDetectOrchestrator
                               .service.ts streams `techdetect:progress`
                               events over the caller's Socket.IO room
```

## Confidence scoring design

Every detector returns `DetectionCandidate[]` — a technology name plus
every `SignalMatch` that fired for it, each with its own standalone
`weight` in `[0, 1]` (how confident you'd be in this candidate if this
were the *only* signal you saw). The confidence engine combines them via
**noisy-OR**: `confidence = 1 - ∏(1 - weight_i)` over every matched signal.

This is a deliberate choice over naive summing (`weight_1 + weight_2 + ...`,
which can exceed 1 and has no probabilistic meaning) or max-only (which
throws away the fact that *multiple independent* signals agreeing is
stronger evidence than one signal alone). Noisy-OR has the right shape for
this problem: a single strong signal (weight 0.9) alone gives confidence
0.9; two weak signals (0.3 each) compound to 0.51, not 0.3 or 0.6; adding
more agreeing signals asymptotically approaches but never reaches 1.0. The
same combination method scores all 16 categories uniformly — no detector
computes its own confidence.

## API

See [docs/API.md](API.md#phase-4--enterprise-smart-technology-detection-engine-api)
for the full `POST /api/techdetect/start` and `GET /api/techdetect/:crawlJobId`
reference.

## Security posture

- Read-only: every probe is a `GET`/`HEAD` request or a TLS handshake — no
  authentication attempts, no exploitation, no fuzzing.
- Every HTTP call goes through Phase 2's `safeFetch` (SSRF-guarded — DNS-
  pinned lookups, private/reserved IP ranges blocked, redirect
  re-validation per hop) — the well-known-path probe list is small and
  fixed, never derived from unsanitized input.
- `robots.txt` is checked (`fetchRobotsTxt`, reused from Phase 2) before
  probing any well-known path beyond the homepage itself; a path
  disallowed by the target site's own robots.txt is skipped and recorded
  as skipped, not silently probed anyway.
- No credentials, secrets, or previously-scanned private content are ever
  sent in a Phase 4 probe request.

## Known limitations (honest, not hidden)

- **Backend framework, programming language, and database detection are
  inherently lower-precision than CMS/frontend/CDN detection.** A
  well-built backend leaves almost nothing in the HTML a browser
  receives — most of what's detectable comes from session-cookie naming
  conventions and response headers, both of which a security-conscious
  deployment can (and often does) rename or suppress, and both of which
  are typically only set once a session/form interaction happens, not on
  a bare homepage GET (verified: `csrfmiddlewaretoken`/session cookies
  frequently don't appear on a Django/Flask site's homepage at all).
  Database technology is inferred purely from CMS/framework ecosystem
  convention or an accidentally-leaked error string — never probed,
  never connected to, and explicitly skipped for fully-managed SaaS
  platforms (Shopify, Wix, Squarespace, Webflow, Blogger) whose database
  is proprietary and irrelevant to report.
- **TypeScript is only inferred from a strong proxy (NestJS), never from
  a generic signal.** TypeScript compiles away entirely and is otherwise
  indistinguishable from JavaScript in anything a browser receives.
- **The Smart Connector Engine doesn't exist yet.** `smartConnectorCompatibility`
  is forward-looking guidance derived from well-known, publicly-documented
  integration patterns for each detected platform (e.g. "WordPress → REST
  API"), not a verified integration — no connector has actually been
  built or tested end-to-end against any of these platforms.
- **A single, well-known-path-existence signal alone is inherently weak
  evidence on any platform with a permissive top-level URL namespace** —
  see the GitHub finding below. These signals are deliberately low-weight
  and a canary probe (a request to a path no real site would serve)
  neutralizes them entirely on sites that return success for arbitrary
  paths, but a path that coincidentally resolves for unrelated reasons on
  a *non*-catch-all site (as GitHub's `/administrator/` does) isn't
  something a canary alone can catch — the residual mitigation is keeping
  these specific signals' weights low enough that they rarely dominate a
  confidence score on their own.

## What real-world testing caught

Every detector has synthetic-fixture unit tests, but the whole pipeline
was also run end-to-end against a deliberately diverse set of real, live
websites (Shopify, Stripe, GitHub, W3Schools, a live Wikipedia article,
every major frontend framework's own site, PyPI, Vercel, Netlify, and
more) — not just the sites each detector was originally written against.
That process caught real bugs no synthetic fixture would have:

- **A bare "productname.js" filename pattern matches prose that merely
  discusses the technology, not just an actual script reference.**
  Verified against a real, live Wikipedia article ("Web development"),
  whose body text literally contains the words "Vue.js" and "Angular" as
  encyclopedic content — with neither framework actually loaded on the
  page. The same class of bug was separately caught earlier for
  WooCommerce (a WordPress *blog* writing about WooCommerce falsely
  detected as a WooCommerce *store*). Fixed by introducing
  `assetUrlHaystack` (actual `<script src>`/`<link href>` values only) and
  moving every bare-filename check (React, Vue, Angular, jQuery, GSAP,
  Three.js, Chart.js, Bootstrap, Swiper, Tailwind) onto it, while
  structural/attribute checks (`data-v-*`, `ng-version`, `MuiXxx-root`, ...)
  stay on the full-page haystack since that markup can't occur in plain
  prose.
- **A single well-known-path-existence signal is unreliable on platforms
  with permissive top-level routing.** GitHub.com returned HTTP 200 for
  both `/administrator/` (a Joomla admin-panel signal) and `/readme.html`
  (a WordPress signal) — not because either CMS is present, but because
  GitHub resolves arbitrary top-level path segments as user/org profile
  lookups, and "administrator" happens to coincidentally resolve. A
  canary probe (a deliberately nonsensical path) was added to catch
  *blanket* catch-all routing (confirmed working against angular.dev, a
  real SPA that returns non-404 for literally any path) — but GitHub's
  canary correctly 404s, since GitHub isn't blanket catch-all, so the
  canary alone didn't fully solve this case. The standalone weights for
  `/administrator/`, `/readme.html`, `/xmlrpc.php`, and `/user/login`
  were substantially lowered to reflect how weak this evidence actually
  is alone, while remaining meaningful in combination with a real signal
  (a generator meta tag, a session cookie).
- **A low-confidence CMS/backend false positive was cascading into a
  confident-looking database guess.** Database ecosystem-convention
  inference originally read the *raw*, pre-confidence-scoring detection
  candidates — so GitHub's spurious low-confidence Joomla/WordPress match
  (see above) was still enough to trigger "conventionally runs on MySQL."
  Fixed by having `detectDatabase` take the already-*scored*
  `ScoredCandidate[]` and only infer from a match at or above a
  confidence floor, which required reordering the orchestrator to score
  CMS/backend before running database inference rather than alongside
  the other detectors.
- **A generic managed-DNS-provider nameserver pattern doesn't identify
  the specific platform that uses it.** `dnsN.pNN.nsone.net` (NS1, a
  general-purpose DNS provider) was originally treated as weak evidence
  for Netlify specifically — but NS1 serves thousands of unrelated
  customers, and GitHub.com uses it (alongside AWS nameservers) while
  having nothing to do with Netlify. Removed entirely rather than kept at
  a lower weight, since the bare pattern isn't evidence for Netlify at
  any weight — Netlify's own *branded* nameservers (`netlifydns.com`)
  remain a reliable, kept signal.
- **Sending 14 well-known-path probes to one host fully concurrently
  briefly caused a real connect-timeout failure**, almost certainly the
  shared undici Agent's per-origin connection pool queuing requests past
  its limit — and running them fully sequentially measured ~14s
  wall-clock, too slow for every scan. Fixed with a small concurrency cap
  (4 at a time), the same "politeness" tradeoff Phase 2's crawler makes
  explicitly with its own per-host rate limiter.
- **NS records rarely exist on the exact hostname being scanned.**
  `resolveNs("books.toscrape.com")` reliably returns `ENODATA` — NS
  records live at the registrable/apex domain (`toscrape.com`), not on
  every subdomain. A naive exact-host lookup would silently return no
  hosting signal for the overwhelming majority of real sites (which
  mostly serve from `www.` or a bare apex that isn't the literal crawled
  host). Fixed by walking up the label chain toward the apex until an
  answer is found.
- **`HSTS: max-age=0` disables HSTS — it doesn't enable it.** A naive
  "is the header present" check reported HSTS as active on a real site
  (`books.toscrape.com`) that was actually sending `max-age=0;
  includeSubDomains; preload`, which tells browsers to *forget* HSTS
  immediately. Fixed by parsing the `max-age` directive and requiring it
  be greater than zero.
- **undici doesn't request response compression by default, and doesn't
  auto-decompress a response once compression is requested.** A real
  site (`books.toscrape.com`) reported no `Content-Encoding` at all under
  the original request — not because it lacks compression support (it
  fully supports Brotli), but because nothing in the request asked for
  it, unlike a browser which always negotiates compression automatically.
  Adding `Accept-Encoding` to the request revealed the real capability,
  but also revealed a second issue: the response body then arrived as raw
  compressed bytes, not decoded text, which would have silently broken
  every HTML parser downstream. Fixed by decompressing the body with
  `node:zlib` according to the real `Content-Encoding` returned, contained
  entirely within `signalCollector.ts` rather than touching the shared,
  foundational `safeFetch` used by every phase of this project.
