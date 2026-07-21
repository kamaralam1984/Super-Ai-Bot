# Enterprise Universal Backend Connector Engine — Extensions (Phase 9)

## What it does, and what it deliberately doesn't rebuild

**Before writing a line of this phase, the codebase was audited against
the full spec** — the same discipline every prior phase documents for
itself. That audit found that most of this phase's spec is already
production-built: Phase 5 (`docs/SMART_CONNECTOR.md`) already implements
OAuth2, JWT, API keys, Basic/Session/Custom-Header/Signed-Request
(HMAC-SHA256) authentication, REST and GraphQL protocol support, webhook
receipt, Swagger/OpenAPI/GraphQL-introspection auto-discovery, endpoint
validation, health monitoring with a rolling score, automatic
reconnection with OAuth token refresh, a circuit breaker, an AES-256-GCM
encrypted credential vault with rotation, structured audit logging, and a
`getProducts`/`getServices`/`getOrderStatus`/`getAppointments`/
`getInventory`/`searchKnowledge` AI tool surface — permission-checked by
Phase 7. And Phase 8 (`docs/CHAT_ENGINE.md`) already implements the exact
"intent → permission check → tool selection → API request → response
formatting → LLM context injection → final response" pipeline this
phase's spec describes.

Rebuilding any of that here in a second, parallel connector system would
be duplication with a real risk of the two implementations drifting apart
— a genuine architecture bug, not thoroughness. So Phase 9 **extends**
Phase 5's `backend/src/connector/` module in place, adding only what a
careful gap analysis found genuinely missing:

- **New protocols**: SOAP (`protocols/soapClient.ts`) and gRPC
  (`protocols/grpcClient.ts`) — Phase 5 covered REST, GraphQL, and
  webhooks; it had no SOAP or gRPC client at all. XML-over-HTTP APIs are
  handled as a response-format concern within the existing REST client,
  not a new protocol client (see "XML API" below).
- **New authentication methods**: Mutual TLS (`client/mtlsAgent.ts`) and
  OpenID Connect (`auth/oidcDiscovery.ts`) — Phase 5 had no way to present
  a client certificate, and OAuth2 alone (Phase 5) never verified *who
  issued* a token, only that one was present.
- **SSL certificate validation** (`validation/sslValidator.ts`) as part
  of the connector validation/health surface — Phase 4's tech-detection
  TLS signal collector does something similar but for a different purpose
  (describing a site for a report, not deciding whether a specific
  connector's certificate is trustworthy going forward).
- **Seven new AI tools** (`searchProducts`, `getProductDetails`,
  `searchServices`, `getOrders`, `getCustomer`, `searchCustomer`,
  `searchAppointments`) — Phase 5/7 had six tools; this spec named
  thirteen.
- **Connection Manager**: Priority Rules + Failover across multiple
  connectors serving the same category, plus a bounded in-process Retry
  Queue (`manage/connectionManager.ts`) — Phase 5 already had a circuit
  breaker and reconnection *within* one connector; there was no
  cross-connector priority/failover orchestration.
- **HSM readiness** in the credential vault (`vault/credentialVault.ts`'s
  `SecretsCipher` interface) — a real abstraction seam, not a fake
  integration (see "Known limitations").

## Folder structure (additions only — see docs/SMART_CONNECTOR.md for the rest)

```
backend/src/connector/
├── protocols/
│   ├── soapClient.ts              SOAP 1.1/1.2 envelope construction + call + fault parsing
│   └── grpcClient.ts              proto-loader-based unary RPC invocation
├── client/
│   └── mtlsAgent.ts                per-connector client-certificate Agent, reusing safeFetch's SSRF guard
├── auth/
│   └── oidcDiscovery.ts            OIDC discovery document + JWKS fetch + ID-token verification (via `jose`)
├── validation/
│   └── sslValidator.ts             real TLS handshake → certificate trust/expiry inspection
├── manage/
│   └── connectionManager.ts        priority ordering, cross-connector failover, bounded retry queue
├── vault/
│   └── credentialVault.ts          extended in place with the SecretsCipher interface (HSM-readiness seam)
├── tools/
│   └── aiToolLayer.ts              extended in place with 7 new tools
└── registry/
    └── connectorRegistry.ts        extended in place with SOAP_API/GRPC_API/XML_API definitions
```

## New protocols

### SOAP

SOAP has no protocol-level way to distinguish a read call from a write
call — unlike REST's GET/HEAD restriction or GraphQL's mutation-keyword
guard, every SOAP operation is just a POST with an arbitrary
`<soap:Body>` payload. The administrator-supplied `allowedActions`
allow-list (`SoapConnectionConfig`, part of `Connector.config`) **is**
this product's least-privilege enforcement for SOAP — an action not on
the list is refused (`SoapActionNotAllowedError`) before any request is
sent. Hospital/school/hotel management systems — explicitly named in the
spec — are frequently SOAP-only, which is the concrete reason this exists.

### gRPC

Deliberately **not** server-reflection-based auto-discovery. gRPC has a
standard reflection service, but (a) many production gRPC servers disable
it for exactly the reason this product cares about — it's an
information-disclosure surface — and (b) dynamically decoding
reflection-returned descriptor bytes into invokable message types has no
way to be verified against a real server in this development
environment. The administrator supplies the `.proto` definition (inline
or a file under this installation's `config/` directory) instead — the
same requirement most API gateways and tools like `grpcurl` impose when
reflection isn't available. Same least-privilege mechanism as SOAP: an
`allowedMethods` allow-list, enforced before the `.proto` is even loaded.

Tested against a **real, local, in-process gRPC server** (not a mock of
`@grpc/grpc-js`) — see `protocols/grpcClient.test.ts`.

### XML API

Not a new client. A plain XML-over-HTTP API still goes through
`client/readOnlyHttpClient.ts`'s existing GET/HEAD-only REST client — only
the response body's format differs (XML instead of JSON), which is a
parsing concern for the AI tool layer's response formatting, not a
distinct protocol requiring its own transport. `XML_API` exists as a
`ConnectorType` for discovery/registry purposes (so a customer's system
described as "XML API" gets a sensible connector recommendation), not
because it needed new network code.

## New authentication methods

- **Mutual TLS** (`MTLS`) — the client certificate itself is the
  credential; there is no bearer header. `client/mtlsAgent.ts` builds a
  per-connector `undici.Agent` carrying the certificate/key/CA, reusing
  `safeFetch`'s exact SSRF-guarded DNS resolution (exported from
  `scanner/http/safeFetch.ts` for this purpose) so an mTLS connector gets
  the same anti-SSRF guarantee every other connector call does.
- **OpenID Connect** (`OIDC`) — layers ID-token verification on top of an
  OAuth2 access token: `auth/oidcDiscovery.ts` fetches and validates the
  issuer's `.well-known/openid-configuration` (checking the document's own
  `issuer` field matches the requested URL — without this, a
  network-level attacker could serve a discovery document pointing at a
  different token/JWKS endpoint entirely), fetches the JWKS via
  `safeFetch` (not a JWT library's own unguarded HTTP client), and
  verifies the ID token's signature/issuer/audience/expiry using `jose` —
  a well-audited, standard library, not hand-rolled JWT verification.
  Once verified, the access token authenticates real API calls exactly
  like `OAUTH2`'s Bearer token.
- **HMAC is deliberately not a new auth method.** `SIGNED_REQUEST`
  (Phase 5) already is this product's HMAC-SHA256 request-signing
  implementation. A second enum value for the identical signing scheme
  would be duplicate code with no new capability — see
  `connector/types.ts`'s `ConnectorAuthMethod` doc comment.

### A note on `jose` and CommonJS

`jose` v6 ships ESM-only (`"type": "module"`, no CJS export condition),
while this backend compiles to CommonJS. It's loaded via a dynamic
`import()` inside each function that needs it, not a static top-level
import — TypeScript would otherwise transpile a static import to a
`require()` call that fails at runtime (`ERR_REQUIRE_ESM`). Verified
against the actual compiled output (`tsc` + plain `node`, not just the
test runner's more lenient module handling) before relying on this
pattern anywhere else.

## SSL certificate validation

`validation/sslValidator.ts` performs a real TLS handshake against a
connector's `baseUrl` (`rejectUnauthorized: false` so the handshake
*completes* even for an untrusted certificate — the point is to inspect
and report on exactly that case) and reports trust status, issuer/
subject, and days-until-expiry. Wired into connector setup
(`connectorOrchestrator.service.ts`, run concurrently with the initial
health check) and into `GET /api/connector/:id`'s live report
regeneration. `connectorReportGenerator.ts`'s security score now reserves
10 of its 100 points specifically for a valid, non-expiring-soon
certificate — `https://` alone was never a strong enough signal (a
self-signed or expired certificate still starts with `https://`).

Tested against real infrastructure, including `badssl.com`'s
purpose-built self-signed/expired test endpoints — the same "test against
real infra, not mocks" philosophy Phases 2–8 already establish.

## Seven new AI tools

| Tool | Category | Notes |
|---|---|---|
| `searchProducts(query)` | products | `?search=` query param |
| `getProductDetails(id)` | products | single-resource read, mirrors `getOrderStatus`'s id-suffix pattern |
| `searchServices(query)` | services | `?search=` |
| `getOrders()` | orders | the list — distinct from `getOrderStatus`'s single-order read |
| `getCustomer(id)` | users | "users" doubles as the customer category — see `types.ts`'s `EndpointCategory` doc comment |
| `searchCustomer(query)` | users | `?search=` |
| `searchAppointments(query)` | appointments | `?search=` |

Every tool is permission-checked in `permission/integration/
authorizedAiToolLayer.ts` exactly like the original six (Phase 7's
`DataScope` gate — `PRODUCTS`/`SERVICES`/`ORDERS`/`CUSTOMERS`/
`APPOINTMENTS` already existed, no new scope needed), and the four
product/service tools get the same best-effort Pricing-field redaction
`getProducts`/`getServices` already had.

## Connection Manager: Priority Rules, Failover, Retry Queue

`Connector.priority` (lower = tried first, ties broken by `createdAt`) is
a new column. `manage/connectionManager.ts`'s `selectConnectorForCategory`
orders every connector that can serve a given category; `withFailover`
tries them in that order, moving to the next candidate on a thrown error
or an unsuccessful result, reporting total failure (never throwing) only
if every candidate fails. Wired into the chat engine's connector-preferred
retrieval path (`chat/chatOrchestrator.service.ts`'s `retrieveEvidence`)
— an installation with, say, both a live ERP connector and a legacy
booking-system connector for appointments now automatically tries the
higher-priority one first and fails over rather than picking whichever
connector happened to be first in an unordered list.

`RetryQueue` is a bounded, **in-process** scheduler for a delayed
re-attempt with exponential backoff — "in-process" is a real, stated scope
boundary matching this product's existing single-long-running-process-
per-installation architecture (the same precedent Phase 6's
`retrain/retrainScheduler.ts` already documents for itself), not a
shortcut unique to this module.

## HSM readiness

`vault/credentialVault.ts` now routes every encrypt/decrypt through a
`SecretsCipher` interface. `Aes256GcmCipher` (the existing software
implementation, keyed by the installer-generated `ENCRYPTION_KEY`) is the
only implementation that ships — **this product's self-hosted,
single-server deployment model has no Hardware Security Module or cloud
KMS to integrate with by default**, and shipping a fake/no-op HSM
integration would be worse than not claiming one. What ships is the real
part: `setSecretsCipher()` lets a future PKCS#11-, AWS KMS-, or HashiCorp
Vault Transit-backed cipher be registered at process startup with zero
changes to any call site.

## API

See [docs/API.md](API.md#phase-9--universal-backend-connector-engine-extensions-api)
for the new/changed routes. Every route in this section lives under the
existing `connectorRouter`, which keeps its existing `x-api-key`
+ rate-limit admin gate — none of this phase's routes are public-facing
(unlike Phase 8's chat routes).

## Security posture

- Zero Trust / least privilege carried forward unchanged from Phase 5:
  every new protocol client still goes through (or reuses the same
  guarantees as) `safeFetch`'s SSRF-guarded resolution; SOAP and gRPC each
  get their own explicit allow-list mechanism since neither protocol has
  REST's GET/HEAD or GraphQL's mutation-keyword structural guarantee.
- No authentication is ever bypassed: OIDC's ID-token verification uses a
  real, audited cryptography library against a real, fetched JWKS; mTLS
  never disables server-certificate verification (`rejectUnauthorized:
  true` always, even while presenting a client certificate) — client auth
  is additive, never a way to skip verifying the server.
- Every new credential shape (`mtls`, `oidc`) is validated by
  `authManager.ts`'s `validateCredentialShape` before it's ever sealed
  into the vault, matching every existing auth method's precedent.

## Known limitations (honest, not hidden)

- **No server-reflection-based gRPC auto-discovery** — see "New
  protocols" above. The administrator must supply the `.proto`.
- **Search query parameter name is not configurable per connector.** The
  four new search tools use `?search=<query>` — the convention both
  WooCommerce's and WordPress's REST APIs already use, and the most
  broadly recognized default. Some platforms (Shopify's Admin API, for
  one) use a different parameter name; a per-connector override is a
  reasonable future enhancement, not something every self-hosted install
  needs on day one.
- **No HSM/KMS implementation ships** — see "HSM readiness" above. The
  seam is real; a concrete driver is not, because there's nothing to
  integrate with in this product's default deployment model.
- **The Connection Manager's Retry Queue is in-process** and does not
  survive a restart — consistent with every other in-process mechanism
  this codebase already documents this way, not a new limitation unique
  to this module.
- **Not yet run against live infrastructure end-to-end** for the SOAP/
  mTLS/OIDC paths specifically (gRPC and SSL validation *were* tested
  against real infrastructure — a real local gRPC server, and real HTTPS/
  badssl.com endpoints, respectively). SOAP's envelope construction and
  fault parsing are unit-tested against synthetic XML; mTLS's Agent
  construction is exercised by type-checking and the existing `safeFetch`
  test suite's coverage of the underlying `dispatcher` override, not a
  live mTLS-requiring server. Documented honestly rather than fabricated.
