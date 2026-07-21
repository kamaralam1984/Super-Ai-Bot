# Enterprise Permission & Connector Access Engine (Phase 7)

## What it does

**Before writing a line of this phase, the codebase was audited against
the full spec to find out what already existed** — the same discipline
Phase 6 documented for itself. That audit found that most of the spec's
"OAuth 2.0 / OpenID Connect / API Keys / JWT / Personal Access Tokens /
Signed Webhooks / Read-only Database Users / Official CMS Plugins / GraphQL
& REST Authentication" list, and all of "Official Connectors / API
Discovery / Connection Test / Secure Storage / Auto Refresh," is already
production-built in Phase 5 (`backend/src/connector/`): OAuth2
client-credentials + refresh-token flows (`auth/authManager.ts`), an
AES-256-GCM credential vault with rotation (`vault/credentialVault.ts`),
API discovery (`discovery/apiDiscoveryEngine.ts`), endpoint validation
(`validation/apiValidationEngine.ts`), health monitoring and automatic
reconnection (`health/healthMonitor.ts`, `reconnect/reconnectionEngine.ts`),
and platform connectors for WordPress, WooCommerce, Shopify, Magento,
OpenCart, PrestaShop, Laravel, generic REST/OpenAPI, GraphQL, and Webhook
(`registry/connectorRegistry.ts`). Rebuilding any of that here would be
duplication with a real risk of the two implementations drifting apart —
so Phase 7 reuses all of it as-is.

**What Phase 5/6 genuinely didn't have is authorization.** Once a
connector was configured, its AI tools (`getProducts`, `getServices`,
`getOrderStatus`, `getAppointments`, `getInventory`) and the Training
Engine's Prisma reads were callable without any check that the
administrator had actually authorized the AI to use that specific
category of business data. There was no setup wizard letting an
administrator individually select Products/Services/FAQs/Orders/
Customers/Inventory/Appointments/Categories/Pricing/Shipping/Blogs/
Support Articles, no least-privilege enforcement beyond "the HTTP client
only sends GET/HEAD," and — the concrete instruction this phase was built
to satisfy — the AI Training Engine assumed direct, unmediated access to
every row `TrainingRecordService` could reach.

Phase 7 closes that gap: a Permission Wizard for granting/revoking each of
the 12 spec-named data categories (per installation or per connector), a
least-privilege access-control engine that defaults to (and only ever
grants) `READ_ONLY`, a durable audit trail of every grant/revoke/check,
and two integration points that make the Training Engine and the
Connector AI tool layer actually consume data through this authorization
layer instead of bypassing it.

## Folder structure

```
backend/src/permission/
├── types.ts                              DataScope, grant/decision/wizard contracts
├── catalog/
│   └── dataScopeCatalog.ts               the 12-category catalog + category-mapping helpers
├── policy/
│   └── leastPrivilegePolicy.ts           READ_ONLY enforcement at the type + runtime level
├── wizard/
│   └── permissionWizardEngine.ts         pure wizard state + submission diffing
├── authorize/
│   └── accessControlEngine.ts            pure allow/deny decision logic
├── redact/
│   └── fieldRedaction.ts                 best-effort price-field stripping (the Pricing scope's enforcement mechanism)
├── audit/
│   └── permissionEvents.ts               structured file-log fan-out, mirrors connector/events/connectorEvents.ts
├── integration/
│   ├── authorizedTrainingRecordService.ts   gates Phase 6's TrainingRecordService reads
│   └── authorizedAiToolLayer.ts             gates Phase 5's connector-backed AI tools
├── permissionRecord.service.ts           Prisma persistence — the only file in permission/ that touches the DB
└── permissionOrchestrator.service.ts      composes the above into what routes/routes into
```

Every module except `permissionRecord.service.ts` is pure (no Prisma, no
network calls) — the same engine discipline Phases 3–6 established.

## The 12 data categories

| Scope | Applies to | Sensitivity |
|---|---|---|
| Products | site + connector | standard |
| Services | site + connector | standard |
| FAQs | site + connector | standard |
| Orders | connector only | sensitive |
| Customers | connector only | sensitive |
| Inventory | connector only | sensitive |
| Appointments | connector only | sensitive |
| Categories | connector only | standard |
| Pricing | site + connector | sensitive |
| Shipping | site + connector | standard |
| Blogs | site + connector | standard |
| Support Articles | site + connector | standard |

**Deliberately not on this list: general crawled website content** (raw
pages, generic knowledge chunks, company/about-page info). Phase 1/2
already establish "the administrator authorized this product to crawl
their own public website" as the authorization boundary for that content
— re-gating it here would be authorization theater over data the customer
already explicitly opted the whole product into processing. The 12
categories above are specifically the ones named in the product spec, and
they map to genuinely sensitive or business-critical data: pricing,
order/customer PII, live inventory, bookings.

`connectorId: null` grants apply to the installation's own crawled
knowledge base (what the Training Engine reads); a non-null `connectorId`
grants apply to one specific Phase 5 connector (what the AI tool layer
calls). They are evaluated independently — a site-level Products grant
does not authorize a connector's live Products API, and vice versa; see
`authorize/accessControlEngine.ts`.

## How a grant is enforced

1. An administrator opens the Permission Wizard (`GET /api/permission/wizard?installationId=...`)
   and submits selected categories (`POST /api/permission/wizard`).
2. `permissionOrchestrator.submitWizard()` diffs the submission against
   current active grants (`wizard/permissionWizardEngine.ts`) and grants/
   revokes exactly what changed — unchanged scopes keep their original
   `grantedAt`/`grantedBy` history rather than being silently recreated.
3. Every grant is `PermissionAccessLevel.READ_ONLY` — there is no other
   legal value (see `policy/leastPrivilegePolicy.ts`'s doc comment for why
   this is enforced at the type level, not just a runtime check).
4. When the Training Engine or the AI tool layer needs to read a category
   of business data, it calls `permissionOrchestrator.checkAccess()`,
   which loads the installation's active grants and evaluates the request
   (`authorize/accessControlEngine.ts`) — allow or deny, both audit-logged.
5. A denial does not throw and abort a whole pipeline run — see
   "Design choice: soft degradation" below.

## Design choice: soft degradation, not hard failure

`AuthorizedTrainingRecordService` and `authorizedAiToolLayer` both treat a
denied scope as "return nothing for this category," not "throw and stop
everything." An administrator who authorized Products but not FAQs still
gets product enrichment out of a training run instead of the whole
pipeline failing; an AI tool call for an unauthorized category returns
`{ ok: false, error: "Permission denied: ..." }` (mirroring the AI tool
layer's existing `ToolResult` failure shape for a disconnected connector)
rather than throwing an HTTP 500. Every check — allowed or denied — is
still individually audit-logged, so "the AI never learned FAQs from this
run because that scope wasn't granted" is a fact recoverable from the
audit trail and from `TrainingResult.accessSummary`, not a silent gap.

## Granularity: per-row filtering where a real signal exists

Some reads gate as a single unit (Products, Services, FAQs, Contacts — no
finer-grained signal exists in the schema to split them further). Others
filter row-by-row against a real field:

- **Policies** are split by `policyType`: `SHIPPING` rows need the
  Shipping scope, every other policy type (refund/warranty/terms/cookies/
  privacy/cancellation/other) needs Support Articles — a training run
  with only Shipping granted still learns shipping policy content while
  correctly withholding refund/warranty text.
- **Knowledge chunks** (quality-check pass) are filtered by
  `KnowledgeChunk.category` via `scopeForChunkCategory` — an unmapped
  category (e.g. "Company") stays ungated; a mapped one (Products, Blogs,
  ...) requires its scope.
- **Knowledge relationship edges** are filtered by both endpoints'
  entity type (`Product`→Products, `Service`→Services, `Faq`→FAQs,
  `Policy`/`Contact`→Support Articles) — an edge is only returned if both
  its source and target entity types are authorized.
- **Pricing** is enforced by field redaction, not category denial: a
  `getProducts`/`getServices` AI tool call authorized for Products but not
  Pricing still returns names/descriptions/availability, with
  price-shaped keys (`price`, `cost`, `discount`, `currency`, ...)
  recursively stripped from the response — see `redact/fieldRedaction.ts`.

## API

See [docs/API.md](API.md#phase-7--enterprise-permission--connector-access-engine-api)
for the full route reference.

## Security posture

- Every grant is `READ_ONLY` — the schema's `PermissionAccessLevel` enum
  has exactly one legal value, so no code path (present or future) can
  construct a write-capable grant even by mistake; `assertReadOnlyAccessLevel`
  and `isForbiddenOperation` add a runtime tripwire on top of the type
  guarantee for any future input surface that builds an access level from
  a plain string. The engine never requests, stores, or acts on
  DELETE/UPDATE/INSERT/DROP/EXECUTE-ADMIN semantics — there is no such
  operation anywhere in its vocabulary.
- Every route requires the same `x-api-key` + per-caller rate limiting as
  every other authenticated API in this product.
- Every grant, revoke, wizard completion, and access check — allowed or
  denied — is recorded both to the structured file audit trail
  (`knowledge/security/auditLog.ts`) and to the durable `PermissionEvent`
  table, matching the spec's explicit "audit logged" requirement for
  authorization events, not just denials.
- No new credential storage, OAuth flow, or token refresh logic is
  introduced by this phase — those remain exclusively Phase 5's
  responsibility (`connector/vault/credentialVault.ts`,
  `connector/auth/authManager.ts`, `connector/reconnect/reconnectionEngine.ts`).
  This phase only decides *whether* a caller may read a category of data,
  never *how* a connector authenticates to reach it.

## Known limitations (honest, not hidden)

- **Pricing redaction is key-name-based, not a field-provenance
  guarantee.** `redactPricingFields` strips common price-adjacent key
  names (`price`, `cost`, `discount`, `currency`, `msrp`, ...) recursively
  from a connector's JSON response. A customer's system returning a price
  under an unrecognized key name (e.g. `unitAmount` in an unusual
  third-party API) would not be caught. This is a pragmatic best effort,
  not a cryptographic or schema-level guarantee — documented rather than
  silently assumed complete.
- **`searchKnowledge` stays open for unfiltered or unmapped-category
  queries.** Only a `category`-filtered search whose category maps to a
  wizard scope is gated; a broad, uncategorized semantic search across the
  whole knowledge base is not blocked by this engine. Phase 3's own
  `SearchQueryLog` audit trail and rate limiting still apply. Fully gating
  free-text search would require classifying result content after
  retrieval, which is a larger change than this phase's scope.
  Custom connector endpoints (`EndpointCategory: "custom"`) are similarly
  ungated — they don't map to any of the 12 wizard categories.
- **No DB-level uniqueness on (installationId, connectorId, dataScope)**
  for `PermissionGrant` — Postgres treats every `NULL` as distinct for
  unique-index purposes, so a unique constraint would only catch duplicate
  connector-scoped grants, not the common site-scoped case (`connectorId`
  null). `permissionRecord.service.ts` enforces "at most one ACTIVE grant
  per (installationId, connectorId, dataScope)" at the application layer
  instead (revoke-then-create inside one transaction), which also
  preserves full history rather than silently overwriting it.
- **No per-caller identity, only a per-installation shared secret** — this
  phase does not introduce a new authentication mechanism. `grantedBy`/
  `revokedBy`/`actor` fields are free-text audit labels supplied by
  whatever admin UI calls this API, not independently verified identities.
  This matches the product's existing single-tenant, single-shared-secret
  security model (see docs/SECURITY.md) rather than inventing a
  parallel one.
- **Official CMS plugins and per-language client SDKs (WordPress/
  WooCommerce/Shopify plugins; Node.js/Python/PHP/Java/.NET SDKs) are out
  of scope for this phase.** Phase 5's connector registry already talks
  to WordPress/WooCommerce/Shopify/Magento/etc. server-side over each
  platform's existing REST/GraphQL API using credentials the administrator
  generates in that platform's own admin panel — a customer does not need
  to install a separate KVL plugin for the connector itself to work.
  Publishable SDKs/plugins would be separate, standalone client-side
  repositories (their own auth flows, packaging, and distribution
  concerns) rather than an extension of this backend engine, and were not
  built here; this is a scope decision made explicit rather than a
  silently dropped requirement.
- **Not yet run against live infrastructure end-to-end** the way Phases
  2–6 document a real-crawl-through-real-training run. This phase's test
  coverage is comprehensive at the unit level (pure engine logic, plus the
  integration wrappers exercised against realistic fakes) but has not had
  a live-connector, live-database, real-admin-workflow pass the way
  earlier phases' "What real-world testing caught" sections describe —
  documented honestly rather than fabricated.
