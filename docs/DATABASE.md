# Database

Schema: `backend/prisma/schema.prisma`. Provider: PostgreSQL. Migrations are
committed under `backend/prisma/migrations/` and applied with `prisma
migrate deploy` — the same migration files run identically in development
and on every customer install.

## Design note: whose database is this?

These tables live **inside the per-installation database that Step 6
creates for the product itself** — not in some separate global
"installer tracking" database. Each self-hosted install gets exactly one
Postgres database (named `kvl_<applicationId>`) and this schema is that
database's bookkeeping: which installation it is, what secrets were issued
(as fingerprints), and what happened during setup.

## Tables

### `installations`

One row per install attempt.

| Column | Type | Notes |
|---|---|---|
| `id` | `text` (cuid) | PK |
| `applicationId` | `text` | unique |
| `installationId` | `text` | unique |
| `websiteName`, `websiteUrl` | `text` | |
| `status` | enum `IN_PROGRESS`/`COMPLETED`/`FAILED`/`ROLLED_BACK` | default `IN_PROGRESS` |
| `startedAt` | `timestamp` | default now |
| `completedAt` | `timestamp?` | set on finalize |

Indexes: PK on `id`, unique on `applicationId`, unique on `installationId`,
btree index on `status`.

### `secret_fingerprints`

One-way audit trail of every generated secret — **never the raw value**.

| Column | Notes |
|---|---|
| `installationId` | FK → `installations.id`, `ON DELETE CASCADE` |
| `secretName` | e.g. `JWT_SECRET`, `ENCRYPTION_KEY` |
| `fingerprintHash` | SHA-256 hex digest of the raw secret |

Unique constraint on `(installationId, secretName)`. Lets an operator verify
"has this installation's `.env` been tampered with since setup" without the
database ever being able to leak a working secret.

### `installation_logs`

A copy of the install run's `InstallProgressEvent` stream, persisted at the
end of a successful (or database-intact-but-failed) run.

| Column | Notes |
|---|---|
| `installationId` | FK → `installations.id`, `ON DELETE CASCADE` |
| `time`, `status`, `component`, `message`, `durationMs?`, `error?` | |

Composite index on `(installationId, time)` for fast per-installation,
chronological retrieval. This is a secondary copy — `logs/installer.log`
(structured JSON lines on disk) is the durable, always-available record; the
DB copy is written only once the database exists and survives.

### Phase 2 — Website Auto Scanner tables

Same database, same per-installation scoping. See
[docs/SCANNER.md](SCANNER.md) for the pipeline that populates these.

| Table | Purpose | Key relations / indexes |
|---|---|---|
| `crawl_jobs` | One row per scan run | FK → `installations.id`; index on `status` |
| `crawled_pages` | One row per crawled URL per run | `@@unique([crawlJobId, url])` — each run keeps its own snapshot, which is what incremental recrawl diffs against; index on `contentHash` |
| `extracted_products` / `extracted_services` / `extracted_faqs` | Structured-data-or-heuristic extraction results | FK → `crawled_pages.id`, cascade delete |
| `processed_documents` | Linked PDF/DOCX/XLSX/CSV/... text extraction | `@@unique([crawlJobId, sourceUrl])` |
| `crawl_reports` | One aggregated report per crawl job | `@@unique([crawlJobId])` |

`CrawlJob.status` moves through `QUEUED → DISCOVERING → CRAWLING →
PROCESSING → COMPLETED` (or `FAILED`/`CANCELLED`). Incremental recrawl
(`recrawl/changeDetector.ts`) queries the most recent `COMPLETED` job for
the same `(installationId, websiteUrl)` and compares `contentHash` per URL
to classify pages as new/modified/unchanged/deleted — verified against a
real site: re-scanning correctly identified 14 of 15 pages as unchanged and
skipped their re-embedding.

### Phase 3 — Enterprise AI Knowledge Builder tables

Same database. See [docs/KNOWLEDGE_BUILDER.md](KNOWLEDGE_BUILDER.md) for
the pipeline that populates these.

| Table | Purpose | Key relations / indexes |
|---|---|---|
| `knowledge_chunks` | Chunked text + embedding + category + language + confidence, ready for retrieval | FK → page *or* document (nullable either way) + `crawlJobId`; `embedding Float[]` — see [Embeddings](SCANNER.md#embeddings) for why this isn't `pgvector`; self-relation `duplicateOfChunkId` for the dedup canonical pointer; indexes on `category`, `isDuplicate` |
| `chunk_versions` | Archived prior states of a chunk (content + embedding + confidence + why it changed) | FK → `knowledge_chunks.id`, cascade delete; `@@unique([chunkId, version])`. A chunk's *current* version isn't a stored column — it's `count(chunk_versions for this chunkId) + 1`, since every content change archives the old state before overwriting |
| `vector_index_meta` | Bookkeeping for each installation's on-disk HNSW index (`vector/vectorStore.ts`) | `namespace` unique (one row per installation); tracks vector count, dimensions, file path, embedding model, last rebuild time |
| `search_query_logs` | Audit trail for every search — answered or refused | Composite index on `(installationId, createdAt)`; `topChunkIds` is a JSON array |

`KnowledgeChunk.isDuplicate` + `duplicateOfChunkId` mirror the same pattern
`ExtractedFaq` already uses: a duplicate is never deleted, just flagged and
pointed at its canonical chunk, which is the only one actually embedded
into the vector index. Rollback (`version/versionManager.ts`) is
forward-only — reverting to an earlier version archives the *current* live
state as a new version rather than deleting anything, verified against a
real chunk: a test rollback correctly restored old content, archived the
pre-rollback state as a new version, and reported the next version number
as `archived-version-count + 1`.

### Phase 4 — Enterprise Smart Technology Detection Engine table

Same database. See [docs/TECH_DETECTION.md](TECH_DETECTION.md) for the
pipeline that populates this.

| Table | Purpose | Key relations / indexes |
|---|---|---|
| `tech_detection_reports` | One row per crawl job: every detected technology category, security/performance findings + scores, overall confidence, recommendations, and Smart Connector Engine compatibility notes | `crawlJobId` unique (one-to-one with `crawl_jobs`, same pattern as `crawl_reports`) |

Every category (`cms`, `frontendFrameworks`, `backendFrameworks`,
`programmingLanguages`, `hosting`, `server`, `cdn`, `database`,
`jsLibraries`, `cssFrameworks`, `seoTools`, `analytics`,
`paymentGateways`, `authentication`, `liveChat`, `forms`) is stored as a
`Json` array of `{ name, confidence, evidence }` objects — never a single
guessed string — matching the spec's "never rely on only one signal,
build a confidence score" requirement at the schema level. `database` is
inference-only (see docs/TECH_DETECTION.md's "Known limitations") — this
table never records anything that was actually queried or connected to.

### Phase 5 — KVL Smart Connector Engine tables

Same database. See [docs/SMART_CONNECTOR.md](SMART_CONNECTOR.md) for the
pipeline that populates these.

| Table | Purpose | Key relations / indexes |
|---|---|---|
| `connectors` | One row per configured connection to a customer's website/CMS/enterprise system. `priority` (Phase 9, default 0) orders which connector is tried first when more than one can serve the same category — see docs/CONNECTOR_EXTENSIONS.md's Connection Manager | FK → `installations.id`; optional FK → `crawl_jobs.id` (`onDelete: SetNull` — a connector outlives the crawl job that recommended it); indexes on `installationId`, `status` |
| `connector_credentials` | Encrypted credential for a connector — AES-256-GCM ciphertext + a one-way fingerprint, never the raw secret | `connectorId` unique (one-to-one), cascade delete |
| `connector_endpoints` | One row per discovered API endpoint, with its validation result | FK → `connectors.id`, cascade delete; `@@unique([connectorId, path])`; `category` matches the AI tool layer's vocabulary (`products`/`orders`/`services`/`users`/`appointments`/`inventory`/`categories`/`blogs`/`faqs`/`search`/`custom`) |
| `connector_health_checks` | Time-series health check history | FK → `connectors.id`, cascade delete; composite index on `(connectorId, checkedAt)` — feeds `computeHealthScore`/`classifyStatus` |
| `connector_events` | Durable per-connector lifecycle audit trail (created/updated/authenticated/api_call/error/retry/health_check/disconnected/recovered) | FK → `connectors.id`, cascade delete; composite index on `(connectorId, createdAt)`; complements (not a replacement for) the structured file audit log every phase's security events also go through |

`Connector.authMethod === "NONE"` with no `ConnectorCredential` row is a
valid, common state — the default for any connector reachable via
genuinely public, unauthenticated endpoints (e.g. a Storefront-only
Shopify connection, or WordPress's public REST API). `ConnectorEndpoint
.validated` is recomputed on every discovery/validation re-run
(`connectorRecord.service.ts`'s `saveEndpoints` upserts by
`(connectorId, path)`), so re-running setup for the same connector never
duplicates rows — it just updates each endpoint's latest validation
result in place.

### Phase 6 — Enterprise AI Training Engine tables

Same database. See [docs/AI_TRAINING_ENGINE.md](AI_TRAINING_ENGINE.md)
for the pipeline that populates these.

| Table | Purpose | Key relations / indexes |
|---|---|---|
| `extracted_contacts` | Structured contact records (phones/emails/addresses/hours/branch/department/contactType), normalized from Phase 2's raw `contactInfo` blob | FK → `crawled_pages.id`, cascade delete |
| `extracted_policies` | One row per policy sub-type detected (PRIVACY/REFUND/SHIPPING/CANCELLATION/WARRANTY/TERMS/COOKIES/OTHER) | FK → `crawled_pages.id`, cascade delete |
| `knowledge_relationships` | The semantic knowledge graph — polymorphic edges between products/services/FAQs/policies/contacts/chunks/categories | No FK relations (deliberately — see docs/AI_TRAINING_ENGINE.md); `@@unique([sourceType, sourceId, targetType, targetId, relationshipType])` makes re-running training idempotent (upsert, not duplicate); indexes on `installationId`, `(sourceType, sourceId)`, `(targetType, targetId)` |
| `training_reports` | One row per training run — the persisted analogue of `crawl_reports`/`tech_detection_reports` | `crawlJobId` unique (one-to-one with `crawl_jobs`) |

`ExtractedProduct`/`ExtractedService`/`ExtractedFaq` (Phase 2 tables) each
gained new columns in this phase (`benefits`/`availability`/
`relatedProducts` on products; `relatedServices`/`dependencies` on
services; `confidence`/`similarQuestions`/`relatedQuestions`/
`mergedFaqIds` on FAQs) rather than new tables — these are enrichments of
existing rows, not new entities. A FAQ's `mergedFaqIds` is only ever
populated on the canonical FAQ of a duplicate cluster; the consolidated
FAQs it points to keep their existing `isDuplicate`/`duplicateOfFaqId`
(Phase 3's mechanism), pointing back at that same canonical.

### Phase 7 — Enterprise Permission & Connector Access Engine tables

Same database. See [docs/PERMISSION_ENGINE.md](PERMISSION_ENGINE.md) for
the design these tables enforce.

| Table | Purpose | Key relations / indexes |
|---|---|---|
| `permission_grants` | One administrator-authorized data category, optionally scoped to a Phase 5 connector (`connectorId` set) or to the installation's own crawled knowledge base (`connectorId` null) | FK → `installations.id`, cascade delete; optional FK → `connectors.id`, cascade delete; indexes on `(installationId, status)`, `connectorId`. No `@@unique` — see below. |
| `permission_events` | Durable audit trail: every grant, revoke, wizard completion, and access check (allowed or denied) | FK → `installations.id`, cascade delete; index on `(installationId, createdAt)`; complements (not a replacement for) the structured file audit log every phase's security events also go through |

`accessLevel` is `PermissionAccessLevel`, an enum with exactly one legal
value (`READ_ONLY`) — there is no write-capable value this column could
ever hold. There is deliberately no `@@unique([installationId,
connectorId, dataScope])` on `permission_grants`: Postgres treats every
`NULL` as distinct for unique-index purposes, so such a constraint would
only catch duplicate *connector*-scoped grants, not the common
site-scoped case (`connectorId` null). `permissionRecord.service.ts`
enforces "at most one ACTIVE grant per (installationId, connectorId,
dataScope)" at the application layer instead — revoking any existing
active grant for that combination inside the same transaction as creating
the new one — which also preserves full grant/revoke history rather than
overwriting a row in place.

### Phase 8 — Enterprise AI Live Chat Engine tables

Same database. See [docs/CHAT_ENGINE.md](CHAT_ENGINE.md) for the pipeline
that populates these.

| Table | Purpose | Key relations / indexes |
|---|---|---|
| `visitors` | One anonymous browser/device, recognized across possibly many conversations via a public (non-secret) fingerprint token | FK → `installations.id`, cascade delete; `@@unique([installationId, fingerprint])` |
| `conversations` | The durable conversation thread — survives reconnects; `topicSummary` is the long-term-memory rolling summary | FK → `installations.id` and `visitors.id`, both cascade delete; `shareToken` unique (nullable); indexes on `(installationId, status)`, `visitorId` |
| `messages` | Every turn, `content` encrypted at rest (AES-256-GCM, same pattern as `connector_credentials`) | FK → `conversations.id`, cascade delete; self-referencing `regeneratedFromId` FK (`onDelete: SetNull`) for the Regenerate Response feature; index on `(conversationId, createdAt)` |
| `escalation_tickets` | A durable "needs a human" queue — reason, channel, status | FK → `conversations.id` and `installations.id`, both cascade delete; indexes on `(installationId, status)`, `conversationId` |

`Message.encryptedContent` is the only place a message's plaintext is
persisted, and only as ciphertext — `chatRecord.service.ts` decrypts
in-process on every read, the same pattern `ConnectorCredential`
established in Phase 5. `Message.sources`/`entities` are `Json` columns
(the `SourceReference[]`/`ExtractedEntity[]` shapes from
`chat/citation/sourceReferenceFormatter.ts`/`chat/nlu/entityExtractor.ts`)
— structured substructure that doesn't need its own table, matching
`ConnectorEndpoint.responseSample`'s precedent. There is deliberately no
separate `ChatEvent`/audit table the way `ConnectorEvent`/`PermissionEvent`
exist: `messages` already *is* the full per-conversation timeline: nothing
security-relevant happens in this phase that isn't either a message or one
of the file-based audit events (`chat_prompt_injection_detected`,
`chat_escalation_triggered`, ...) every prior phase's security events also
go through.

### Phase 10 — Automatic Website Update Engine tables

Same database. See [docs/AUTO_UPDATE_ENGINE.md](AUTO_UPDATE_ENGINE.md) for
the engines that populate these.

| Table | Purpose | Key relations / indexes |
|---|---|---|
| `notifications` | One event worth telling an administrator about — always persisted regardless of which delivery channels are also configured (Dashboard reads this table directly) | FK → `installations.id`, cascade delete; indexes on `(installationId, createdAt)`, `(installationId, readAt)` |
| `notification_deliveries` | Per-channel delivery outcome for one notification (a failed email send never loses the notification itself) | FK → `notifications.id`, cascade delete; index on `notificationId` |
| `notification_settings` | Per-installation channel opt-in + per-type scoping for Email/Webhook (Dashboard/Log always receive everything) | FK → `installations.id`, cascade delete; `installationId` unique |
| `background_jobs` | Durable job history/audit trail — survives the in-process run that executed the job, independent of `JobQueue`'s own in-memory scheduling | FK → `installations.id`, cascade delete; indexes on `(installationId, status)`, `(status, scheduledFor)` |
| `scan_schedules` | A persisted cron schedule definition + which crawl job's config to replay; execution stays in-process, but the definition now survives a restart | FK → `installations.id`, cascade delete; indexes on `installationId`, `(enabled, nextRunAt)` |
| `knowledge_comparison_reports` | One row per training run comparing it against the previous completed run — page/chunk/entity/metadata change counts plus structured detail (`Json`) | FK → `crawl_jobs.id` (`crawlJobId` unique), cascade delete |

`CrawlJob` also gained two columns this phase: `sitemapUrls Json?` and
`robotsTxtContent String? @db.Text` — both were already computed during
discovery (`discoveryService.ts`) but never persisted before, so
`siteMetadataMonitor.ts` had nothing to diff against for sitemap/robots
change detection.

`entityChanges`/`metadataChanges`/`categoryBreakdown` on
`knowledge_comparison_reports` are `Json` columns holding the
`EntityChangeSummary[]`/`MetadataChangeSummary`/`Record<string,
CategoryBreakdownEntry>` shapes from `comparisonReportBuilder.ts` —
structured substructure that doesn't need its own table, the same
precedent `Message.sources` (Phase 8) and `ConnectorEndpoint.responseSample`
(Phase 5) already established.

### Phase 11 — Production Deployment System tables

Same database. See [docs/DEPLOYMENT.md](DEPLOYMENT.md) for the systems
that populate these.

| Table | Purpose | Key relations / indexes |
|---|---|---|
| `backup_records` | One row per backup attempt, including failed ones — a gap in backup history should be visible, not silently absent | FK → `installations.id`, cascade delete; index on `(installationId, createdAt)` |
| `plugins` | Registered plugin lifecycle state (installed/enabled/disabled/error) + declared permissions | FK → `installations.id`, cascade delete; unique on `(installationId, name)` |
| `licenses` | Local, offline-verified license activation state — one per installation | FK → `installations.id`, cascade delete; `installationId` unique |

Deliberately no table for Update Manager or Recovery — both operate on the
Docker host itself (`deploy/scripts/update.sh`) and report status by
reading the filesystem/Docker directly, not by maintaining their own
persisted history; see DEPLOYMENT.md's "Automatic Updates" section.

`plugins.permissions`/`plugins.manifest` and `licenses.payload` are `Json`
columns holding, respectively, the `PluginPermission[]`/full manifest
shapes from `pluginManifest.ts` and the full signed `SignedLicenseFile`
envelope from `licenseValidator.ts` — the same "structured substructure
doesn't need its own table" precedent noted above. `licenses.payload`
specifically must be stored verbatim (not reconstructed from other
columns) because `licenseService.ts`'s `validateLicense` re-verifies its
Ed25519 signature on every check — reconstructing it from separate columns
would make that re-verification meaningless (there'd be nothing to detect
tampering against).

## Rollback strategy

- If **role/database creation or migration itself fails**, the orchestrator
  calls `rollbackDatabase()` (`DROP DATABASE IF EXISTS` + `DROP ROLE IF
  EXISTS`) automatically, so a retry starts from a clean slate.
- If a **later step** (directories, finalizing) fails after the database was
  already fully migrated, the database is **left intact** — it wasn't the
  cause of the failure — and its `installations` row is simply marked
  `FAILED` for audit purposes instead of being destroyed.
- `POST /api/database/rollback` is also available standalone for manual
  cleanup.

## Shadow database (development only)

`prisma migrate dev` (used only when authoring new migrations, never on a
customer install) needs a throwaway "shadow" database to diff against,
which requires `CREATEDB` privilege — a privilege the per-install app role
intentionally does **not** have. `schema.prisma` points `shadowDatabaseUrl`
at `SHADOW_DATABASE_URL`, an admin connection, so the app's runtime role can
stay least-privilege while migration authoring still works.
