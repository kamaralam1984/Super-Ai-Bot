# KVL Smart Connector Engine (Phase 5)

## What it does

Phase 4 identifies what a customer's website/application runs on. Phase 5
takes that report and actually connects to it — recommends the right
connector, authenticates, discovers its read-only API surface, validates
every endpoint it finds, monitors connection health continuously, and
exposes a small, permission-checked set of AI tools (`getProducts`,
`getServices`, `getOrderStatus`, `getAppointments`, `searchKnowledge`,
`getInventory`) for the chatbot to call.

**Read-only, always — not by convention, by construction.** Every REST call
this engine makes is restricted to `GET`/`HEAD` at the HTTP client layer
(`client/readOnlyHttpClient.ts`); there is no code path that can issue a
`POST`/`PUT`/`PATCH`/`DELETE` against a connected system. The one exception
— GraphQL, which conventionally uses `POST` even for reads — is handled by
parsing the query and refusing to send anything containing a
`mutation`/`subscription` keyword, so "read-only" still means "read-only"
rather than "no POST verb."

**Deliberately a separate, re-runnable stage from tech detection itself**
— the same relationship Phase 4 has to Phase 2, and Phase 3 has to Phase 2.
`runConnectorSetup()` takes a `crawlJobId` (to read Phase 4's report) or a
manual override and can be re-run at any time to re-discover/re-validate a
connector without re-running detection.

## Supported platforms

| Category | Connector types |
|---|---|
| CMS | WordPress, WooCommerce, Shopify, Magento, OpenCart, PrestaShop |
| Frameworks | Laravel (dedicated); Next.js, React, Node.js, Express.js, NestJS, Django, FastAPI, ASP.NET, Spring Boot (Generic REST, with OpenAPI/Swagger auto-discovery) |
| Enterprise systems | ERP, CRM, HRMS, LMS, Inventory System, Booking System (Universal REST — no single standard API shape exists across vendors, so this is the spec's own named fallback) |
| Custom | REST API, GraphQL API (Universal GraphQL — introspection-based discovery), Webhook (inbound-only, no outbound discovery) |

See `registry/connectorRegistry.ts` for the exact platform → connector-type
mapping and each connector's known endpoint patterns.

## Folder structure

```
backend/src/connector/
├── types.ts                        shared ConnectorType/AuthMethod/Status contracts
├── registry/
│   └── connectorRegistry.ts        static platform → connector-type + known-endpoint definitions
├── vault/
│   └── credentialVault.ts          seal/open/rotate credentials — wraps Phase 3's AES-256-GCM encryption.ts
├── auth/
│   └── authManager.ts              resolves auth headers per method; OAuth2 client-credentials + refresh-token handshakes
├── client/
│   ├── readOnlyHttpClient.ts       the GET/HEAD-only (+ mutation-free GraphQL) enforcement layer — every outbound call goes through this
│   └── circuitBreaker.ts           small hand-rolled CLOSED/OPEN/HALF_OPEN breaker
├── recommend/
│   └── recommendationEngine.ts     Phase 4 TechnologyReport → ConnectorRecommendation
├── discovery/
│   └── apiDiscoveryEngine.ts       known-pattern + OpenAPI/Swagger + GraphQL-introspection endpoint discovery
├── validation/
│   └── apiValidationEngine.ts      per-endpoint auth/status/latency/JSON-shape validation
├── health/
│   └── healthMonitor.ts            health checks + 0-100 health score
├── reconnect/
│   └── reconnectionEngine.ts       token refresh + bounded retry on failure
├── errors/
│   └── errorClassifier.ts          401/403/404/429/5xx/timeout/DNS/SSL → category + recovery suggestion
├── tools/
│   └── aiToolLayer.ts              getProducts/getServices/getOrderStatus/getAppointments/getInventory/searchKnowledge
├── events/
│   └── connectorEvents.ts          fans a connector event out to the structured file audit log
├── report/
│   └── connectorReportGenerator.ts assembles the final ConnectorReport
├── connectorRecord.service.ts      Prisma persistence (only module that touches the database)
└── connectorOrchestrator.service.ts   top-level pipeline + WebSocket progress
```

Every module except `connectorRecord.service.ts` is Prisma-free; every
module except `client/readOnlyHttpClient.ts`, `auth/authManager.ts`
(OAuth2 handshake only), `discovery/`, `validation/`, and `health/` is also
network-free — the same "pure engine + one record service + one
orchestrator" discipline Phases 2-4 already established, so every category
is independently unit-testable.

## Pipeline

```
Phase 4 TechnologyReport (or a manual override)
   │
   ▼
Recommend ── recommend/recommendationEngine.ts picks the best-fit connector
   │           type from the top-confidence CMS/backend-framework candidate,
   │           refines the auth method from Phase 4's `authentication`
   │           signal, and falls back to Universal REST when nothing
   │           matches confidently — treats Phase 4's own
   │           smartConnectorCompatibility.recommendedConnectors as a
   │           corroborating signal, not something to recompute
   ▼
Create + authenticate ── connectorRecord.service.ts creates the Connector
   │                       row; if a credential was supplied, auth/authManager
   │                       validates its shape and vault/credentialVault
   │                       seals it (AES-256-GCM) before it ever touches disk
   ▼
Discover ── discovery/apiDiscoveryEngine.ts probes the registry's known
   │          patterns, then universal OpenAPI/Swagger spec paths, then (for
   │          GraphQL connectors) introspection — runs under its own
   │          generous, isolated rate-limit budget separate from the
   │          connector's real runtime limit (see "What real-world testing
   │          caught" below for why that isolation matters)
   ▼
Validate ── validation/apiValidationEngine.ts actually calls every
   │          discovered endpoint and checks auth, HTTP status, latency,
   │          and JSON shape — discovery proves an endpoint exists,
   │          validation proves the AI tool layer can depend on it
   ▼
Health check ── health/healthMonitor.ts pings the first validated endpoint
   │              (or "/") and classifies CONNECTED/DEGRADED/DISCONNECTED
   ▼
Report + persist ── report/connectorReportGenerator.ts assembles platform,
                      connector, auth method, API inventory, health score,
                      security score, and recommendations; persisted via
                      connectorRecord.service.ts; connectorOrchestrator
                      .service.ts streams `connector:progress` over the
                      caller's Socket.IO room throughout
```

Ongoing, after setup: `POST /api/connector/:id/health-check` re-checks and,
on failure, runs `reconnect/reconnectionEngine.ts` (OAuth2 token refresh if
expired, then up to 3 bounded retries with backoff) before reporting a
final status — this never blocks the AI service; a tool call against a
disconnected connector fails fast with a clear message instead of hanging.

## Read-only enforcement design

"Read-only" is enforced at exactly one choke point
(`client/readOnlyHttpClient.ts`), not scattered as a convention across
every caller:

- **REST**: `restGet()` only accepts `GET`/`HEAD` — there is no parameter
  that can smuggle a different verb through.
- **GraphQL**: `graphqlQuery()` sends `POST` (required by the GraphQL-over-
  HTTP convention — introspection and reads are POST requests too), but
  first strips `#`-comments and rejects the query if it contains a
  `mutation`/`subscription` keyword anywhere. This is what "read-only"
  actually has to mean for GraphQL, since blocking `POST` outright would
  also block introspection and every real read query.
- **OAuth2 token exchange** (`auth/authManager.ts`'s `acquireOAuth2Token`/
  `refreshOAuth2Token`) is the one place that sends `POST` outside this
  guard — a standard RFC 6749 auth handshake against the target's *token
  endpoint*, not its business API, and it never touches product/order/
  customer data.

Every one of those calls still goes through Phase 2's `safeFetch` (SSRF-
guarded DNS resolution, redirect re-validation per hop) — extended in this
phase to support a request body, needed for the GraphQL query and OAuth2
token exchange.

## Authentication methods

API Key, Bearer Token, JWT, OAuth2, Basic Auth, Session Cookie, Custom
Headers, and a hand-rolled HMAC-SHA256 Signed Request scheme (`X-KVL-Key-
Id`/`X-KVL-Timestamp`/`X-KVL-Signature`, signed over
`method\npath\ntimestamp`). OAuth2 supports the client-credentials grant
(machine-to-machine, no browser involved) and using/refreshing an
already-obtained access+refresh token pair — a full interactive
authorization-code flow needs a browser redirect/consent screen that
doesn't fit a backend connector setup, so that handshake is expected to
happen once, externally, with the resulting token pair handed to this
engine.

Every credential is sealed via `vault/credentialVault.ts` before storage:
AES-256-GCM ciphertext (reusing Phase 3's `encryption.ts`, unused
elsewhere until this phase) plus a one-way SHA-256 fingerprint (reusing
Phase 1's `security.service.ts`) for audit — the raw secret is never
written to the database, logs, or a `ConnectorReport`.

## Security posture

- Least-privilege by default: a connector with no supplied credential uses
  `NONE` auth and can only ever reach genuinely public endpoints.
- Every credential is AES-256-GCM encrypted at rest; only a one-way
  fingerprint is ever logged or audited.
- Every outbound call is SSRF-guarded (Phase 2's `safeFetch`), rate-limited
  per connector (token bucket), retried with bounded exponential backoff,
  and circuit-broken per connector after repeated failures — one
  connector's failures can't starve or trip another's breaker (see
  regression note below).
- Every connector lifecycle event (created, authenticated, API call,
  error, retry, health check, disconnected, recovered) is logged through
  `events/connectorEvents.ts` into the same structured file audit trail
  every other phase's security events use (`auditLog.ts`, extended with
  nine `connector_*` event types), and durably persisted per-connector in
  `ConnectorEvent` for the admin UI timeline.
- `connectorReportGenerator.ts`'s security score is computed from real,
  checkable facts about the connection (HTTPS base URL, non-`NONE` auth,
  at least one endpoint that actually validated, `CONNECTED` status) —
  never a static or assumed value.

## Known limitations (honest, not hidden)

- **Enterprise systems (ERP/CRM/HRMS/LMS/Inventory/Booking) have no
  universal API shape.** There is no equivalent of "WordPress → `/wp-json/
  wp/v2/`" for this category — vendors differ completely. The Universal
  REST connector's discovery relies entirely on OpenAPI/Swagger
  auto-probing and administrator-supplied endpoint hints; it will not
  reliably discover a bespoke enterprise API with no machine-readable spec.
- **OAuth2 support does not include the interactive authorization-code
  flow.** Only client-credentials (machine-to-machine) and using/refreshing
  an already-obtained token pair are implemented — a full browser-redirect
  consent flow is out of scope for a backend connector engine and would
  need a separate, user-facing admin step to produce the initial token.
- **OpenCart has no standard REST API by default.** Its connector targets
  the common third-party REST extension route and degrades to Universal
  REST discovery when that extension isn't installed.
- **The GraphQL mutation guard is a conservative keyword scan, not a full
  parser.** It strips `#`-comments and rejects any query containing
  `mutation`/`subscription` as a whole word anywhere — this can, in
  principle, over-block a query that merely names a field or argument
  containing that word outside a comment; it will never under-block an
  actual mutation. Given the security purpose, over-blocking is the
  correct failure direction.

## API

See [docs/API.md](API.md#phase-5--kvl-smart-connector-engine-api) for the
full route reference.

## What real-world testing caught

Every pure engine module has synthetic-fixture unit tests, but discovery,
validation, health checks, and the HTTP client were also run against
genuinely live, public infrastructure — a real Shopify store, a real
WordPress site's REST API, the reference Swagger Petstore OpenAPI server,
and a real public GraphQL API — not just mocks. That process caught real
bugs no synthetic fixture would have:

- **Discovery and validation silently self-rate-limited mid-scan, making
  real endpoints intermittently vanish from the report with no trace.**
  Running the full pipeline against a real, live Shopify store
  (`allbirds.com`) repeatedly and comparing results run-to-run showed the
  known-pattern endpoint count varying between 3 and 5 out of 5 real,
  reachable endpoints — including the public, unauthenticated
  `/products.json` sometimes missing entirely. Root cause: discovery (5
  known-pattern + up to 5 OpenAPI probe calls) and validation (one call
  per discovered endpoint) shared the connector's single steady-state
  rate-limit bucket — sized for ongoing AI-tool-call traffic (10-token
  burst, 2/sec refill), not a one-time ~15-call setup scan — and a
  `RateLimitedError` thrown mid-scan was silently caught and treated as
  "endpoint doesn't exist," identically to a genuine 404. Fixed by giving
  setup-time scanning its own generous, isolated rate-limit bucket
  (`connectorOrchestrator.service.ts`, keyed by `${connectorId}:setup`
  rather than the connector's real id) — verified with 13+ consecutive
  real re-runs against the same live store after the fix, all discovering
  and validating the full 5/5 known endpoints. A permanent regression test
  covers this exact scenario (`discovery/apiDiscoveryEngine.test.ts`).
- **The circuit breaker was a single shared instance across every
  connector in the process, ignoring each connector's own configured
  threshold.** `client/readOnlyHttpClient.ts` originally constructed one
  module-level `CircuitBreaker({ failureThreshold: 5, resetTimeoutMs:
  30_000 })` and reused it for every connector — so one connector's own
  `config.circuitBreaker` settings were silently discarded, and (more
  seriously) a burst of failures against one customer's connector could in
  principle affect the breaker state checked for a different connector's
  calls, since `CircuitBreaker` tracks per-key state internally but the
  fixed *thresholds* were global. Caught while writing an isolation test
  (verifying one connector's failures don't affect another's breaker) and
  confirmed by inspection before the test even ran. Fixed by making
  breaker instances per-connector, mirroring the pattern the rate limiter
  already used (`breakerFor()`, lazily constructed per `connectorId` from
  that connector's own config) — covered by
  `client/readOnlyHttpClient.test.ts`'s isolation and regression tests.
- **The universal OpenAPI probe list missed the very common "API mounted
  under a version prefix" convention.** Probing the reference Swagger
  Petstore server (`petstore3.swagger.io`) — chosen specifically because
  it's a different, independent implementation from anything the discovery
  patterns were written against — returned 404 for every one of the
  original five probe paths (`/openapi.json`, `/swagger.json`, `/swagger/
  v1/swagger.json`, `/v3/api-docs`, `/.well-known/openapi.json`); its real
  spec lives at `/api/v3/openapi.json`. Fixed by adding versioned `/api/
  v{1,2,3}/openapi.json` and `/api/{openapi,swagger}.json` probe paths —
  a real, common pattern for APIs mounted behind a path prefix that the
  original list simply didn't anticipate.
- **A real public HTTP-echo test service (httpbin.org) proved too slow and
  inconsistent for a reliable automated test**, occasionally taking 3-5+
  seconds per request and risking the 10-second timeout in `safeFetch`.
  Switched the OAuth2-handshake error-path test to `postman-echo.com`,
  which consistently responded in well under half a second across repeated
  checks — the test still validates real behavior against a real server,
  just a more dependable one.
