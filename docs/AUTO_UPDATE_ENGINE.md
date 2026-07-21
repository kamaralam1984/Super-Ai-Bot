# Enterprise Automatic Website Update Engine (Phase 10)

## What it does, and what it deliberately doesn't rebuild

**Before writing a line of this phase, the codebase was audited against
the full spec** — the same discipline every prior phase documents for
itself. That audit found real, working infrastructure already covering
part of the spec: Phase 2's `scanner/recrawl/changeDetector.ts` (page-
level new/modified/unchanged/deleted classification), Phase 3's
`knowledge/update/autoUpdateEngine.ts` (which chunks need reprocessing)
and `knowledge/version/versionManager.ts` (per-chunk archive + rollback),
and Phase 6's `training/incremental/incrementalTrainer.ts` (wiring the
first two together into an incremental training plan). Notably,
`changeDetector.ts`'s `planIncrementalRecrawl`/`summarizePlan` functions
were already fully built and tested but **never actually called by
anything** until this phase — `incrementalTrainer.ts` used
`planIncrementalRecrawl` internally but discarded the page-change counts
after using them for scope-planning; `scanOrchestrator.service.ts`
duplicated the same new/modified logic ad-hoc with raw hash comparison
instead of using the module at all. This phase closes that gap by
finally consuming `summarizePlan`'s output for real (see "Knowledge
Comparison Engine" below) rather than adding a second, competing
page-diff implementation.

What was genuinely missing — and what this phase adds — is everything
about *knowing what changed at the business-entity level*, *reporting it*,
*scheduling recrawls on a timer*, *running background work with
persisted history*, and *telling an administrator about it*:

- **Entity-Level Change Detection** (`monitor/detect/entityChangeDetector.ts`)
  — product price/stock/description changes, service pricing changes, FAQ
  answer changes, policy content changes, contact detail changes. None of
  this existed before: Phase 2/3/6's change detection only ever asked "did
  this *page's* content hash change," never "did this *specific product's
  price* change."
- **Site Metadata Monitoring** (`monitor/detect/siteMetadataMonitor.ts`)
  — sitemap.xml URL list changes, robots.txt content changes, technology
  stack changes. The sitemap/robots data these compare wasn't even
  persisted anywhere before this phase (see "Schema" below).
- **Knowledge Comparison Engine** (`monitor/compare/comparisonReportBuilder.ts`)
  — assembles page changes + chunk changes + entity changes + metadata
  changes into one persisted `KnowledgeComparisonReport` row per training
  run, plus human-readable highlights.
- **Cron-based Scheduled Recrawling** (`monitor/schedule/cronScheduler.ts`,
  the `ScanSchedule` table, `POST /api/monitor/schedules`) — real
  cron-expression scheduling (hourly/daily/weekly/monthly presets or a raw
  expression), persisted so a restart doesn't silently forget a schedule
  the way Phase 6's interval-only `retrain/retrainScheduler.ts` did.
- **A generic Background Job System** (`monitor/jobs/jobQueue.ts`, the
  `BackgroundJob` table) — priority ordering, bounded concurrency, retry
  with backoff, a durable history of what ran and what failed.
- **Notification Engine** (`monitor/notify/`) — Dashboard (the
  `Notification` table itself), Log (structured logger), Email (SMTP via
  nodemailer), and Webhook (HMAC-signed HTTP POST) channels, each
  independently opt-in and type-scoped per installation.
- **Webhook-triggered on-demand rescans** (`POST /api/monitor/webhook/scan`)
  — reuses Phase 2's `runWebsiteScan` exactly, authenticated by the same
  `WEBHOOK_SECRET` every installation already generates at install time.
- **Training-run-level Rollback** (`knowledge/rollback/trainingRunRollback.service.ts`,
  `POST /api/knowledge/rollback/training-run`) — extends Phase 3's
  per-chunk `planRollback` to whole-run scope: every chunk one training
  run touched is either restored to its pre-run state or deleted (if the
  run created it fresh), in one operation.

## Folder structure

```
backend/src/monitor/
├── detect/
│   ├── entityChangeDetector.ts       Product/service/FAQ/policy/contact field-level diffing
│   └── siteMetadataMonitor.ts        Sitemap/robots.txt/technology diffing
├── compare/
│   └── comparisonReportBuilder.ts    Assembles + summarizes one KnowledgeComparisonReport
├── schedule/
│   └── cronScheduler.ts              Cron expression parsing + in-process CronRuntime
├── jobs/
│   └── jobQueue.ts                   Generic priority/retry/concurrency-bounded job queue
├── notify/
│   ├── notificationEngine.ts         Pure channel-selection + notification-derivation logic
│   ├── emailChannel.ts               SMTP delivery (nodemailer)
│   └── webhookChannel.ts             HMAC-signed outbound delivery + inbound signature verification
├── monitorRecord.service.ts          The only Prisma-touching file in this domain
└── monitorOrchestrator.service.ts    Composes the above with Prisma + Phase 2/6 pipelines

backend/src/knowledge/rollback/
└── trainingRunRollback.service.ts    Training-run-level rollback orchestrator

backend/src/routes/
├── monitorWebhook.routes.ts          Inbound webhook-triggered scan + status poll
└── monitor.routes.ts                 Reports/notifications/jobs/schedules admin API
```

Every `detect/`, `compare/`, `schedule/` (parsing/decision logic), `jobs/`,
and `notify/` (decision logic) module is pure — no Prisma, no network —
matching every prior phase's "engines are pure, exactly one record service
touches Prisma" discipline. `emailChannel.ts`/`webhookChannel.ts` are the
two necessary exceptions (real I/O is their entire job), same as every
other phase's auth/delivery modules.

## Database schema

Added to `CrawlJob`: `sitemapUrls Json?`, `robotsTxtContent String? @db.Text`
— discovery already computed both (`discoveryService.ts`) but neither was
persisted before this phase, so `siteMetadataMonitor.ts` had nothing to
diff against. `robotsTxt.ts`'s `fetchRobotsTxt` now also returns the raw
fetched body (`rawContent`), previously discarded after parsing.

New models (see `prisma/schema.prisma`): `Notification` +
`NotificationDelivery` (per-channel delivery outcome), `NotificationSettings`
(per-installation channel opt-in/type-scoping), `BackgroundJob`,
`ScanSchedule`, `KnowledgeComparisonReport`. New enums: `NotificationType`,
`NotificationSeverity`, `NotificationChannelType`, `NotificationDeliveryStatus`,
`JobType`, `JobStatus`.

## How a training run becomes a comparison report + notifications

`routes/training.routes.ts`'s `POST /api/training/start` /
`/api/training/retrain` already ran `runAiTraining` (Phase 6). This phase
adds one step after it succeeds: `monitorOrchestrator.service.ts`'s
`runPostTrainingMonitoring` —

1. **`generateComparisonReport`** loads this crawl job's and the previous
   completed crawl job's page hashes, product/service/FAQ/policy/contact
   snapshots, and sitemap/robots/tech-stack snapshots (all scoped strictly
   by `crawlJobId` — see `entityChangeDetector.ts`'s own note on why every
   recrawl's entities are fresh rows, never updated in place). Runs every
   `detect*Changes` function, assembles the result via
   `buildComparisonReport`, and persists it (`crawlJobId` is `@unique` —
   rerunning training for the same crawl job regenerates rather than
   duplicates its report).
2. **`deliverTrainingNotifications`** derives the notification events the
   report implies (`deriveTrainingNotifications` — always exactly one
   `TRAINING_COMPLETED`, plus `WEBSITE_UPDATED`/`KNOWLEDGE_UPDATED` when
   anything actually changed, `NEW_PRODUCTS_FOUND`/`NEW_SERVICES_FOUND`
   on additions, `TECHNOLOGY_CHANGED` on a stack change), persists each as
   a `Notification` row, and delivers to whichever channels
   `NotificationSettings` enables for that installation.

The very first training run for an installation has no previous crawl job
to diff against — every entity reports as "added," every metadata flag is
`false`. That's the honest, correct baseline answer, not a special case
worked around.

This hook is fire-and-forget from the training route's perspective and
never throws back into it — a monitoring/notification failure must never
be mistaken for the training run itself having failed, since the run
already succeeded by the time this runs.

## Scheduled Recrawling

`POST /api/monitor/schedules` registers a `ScanSchedule` (a preset or raw
cron expression) referencing an existing completed crawl job — "replay
this exact website+options on a schedule." Firing (`executeScheduledScan`)
runs the same `runWebsiteScan` → `runAiTraining` → `runPostTrainingMonitoring`
chain a manual scan+train pair would; a schedule firing is functionally
"do exactly what an administrator would do by hand," on a timer.

Execution is in-process — this product's documented single-long-running-
process-per-installation model (`retrain/retrainScheduler.ts`'s own
precedent) — but unlike that scheduler, the schedule *definition* now
survives a restart: `index.ts` calls `registerAllScanSchedules` once at
boot to re-register every enabled `ScanSchedule` with the in-process
`CronRuntime`.

## Webhook-triggered on-demand scans

`POST /api/monitor/webhook/scan` — HMAC-SHA256-verified (`X-KVL-Signature`
header, signed over the exact raw request body via the installation's
`WEBHOOK_SECRET`) inbound trigger, reusing `runWebsiteScan` exactly as
`scan.routes.ts`'s manual "start scan" button does. Responds `202` with a
`jobId` immediately (a `BackgroundJob` row); `GET /webhook/scan/:jobId`
(gated by a constant-time-compared `X-KVL-Secret` header, since there's no
request body to HMAC on a GET) polls for completion.

## Background Job System

`monitor/jobs/jobQueue.ts`'s `JobQueue` is a generic, priority-ordered,
concurrency-bounded, retrying job runner — fully built and tested
(priority ordering, exponential backoff, concurrency limits, a
`setTimeout` 32-bit-overflow-safe wake timer for delayed retries). It is
**not** currently the execution path for webhook-triggered scans or
scheduled recrawls — both of those run immediately/inline rather than
being enqueued, since neither has a reason to wait for a concurrency slot
in this product's single-long-running-process model. `BackgroundJob` rows
are written directly by whichever caller starts the work (`monitorRecord.service.ts`'s
`createBackgroundJob`/`completeBackgroundJob`/`failBackgroundJob`) as a
durable history/audit table, independent of `JobQueue`'s own in-memory
scheduling. `JobQueue` is available, tested infrastructure for a future
caller that genuinely needs bounded concurrency across many simultaneous
jobs — documented honestly as built-but-not-yet-wired rather than
force-fitted into a place it doesn't add value.

## Training-run-level Rollback

`versionManager.ts`'s `planTrainingRunRollback` extends the existing
per-chunk `planRollback` to run scope: every chunk still attributed to one
crawl job (`KnowledgeChunk.crawlJobId`) is either restored to its
`archivedDuringRun` `ChunkVersion` snapshot (if the run *updated* it) or
deleted outright (if the run *created* it fresh — there's no prior state
to restore to). `trainingRunRollback.service.ts` composes this with
Postgres writes and a vector-index update (`vectorStore.upsertMany`/`remove`)
so the vector index and Postgres content never diverge after a rollback —
closing a real, pre-existing gap where the original per-chunk
`POST /api/knowledge/rollback` route restored Postgres content but left
the vector index stale (fixed alongside this phase).

**Scoping note, stated honestly**: this rolls back a chunk only while its
live `crawlJobId` still points at the run being rolled back. `ChunkVersion`
records no `crawlJobId` of its own, so once a *later* run touches the same
chunk again, that chunk's provenance for the earlier run is gone — rolling
back run N after run N+1 has already re-touched some of run N's chunks
will simply leave those particular chunks alone (not guess, not corrupt
state) rather than attempt multi-run history reconstruction the schema
doesn't support. The common real case this serves — "that last run broke
something, undo it, right now" — is exactly the case where this holds:
nothing has touched those chunks since.

**Also stated honestly**: config and connector rollback (named in the
original spec's Rollback Engine list) are not implemented. Neither has any
version history to roll back to — a training run doesn't touch either, so
there is nothing this phase could roll back for them without inventing an
unrelated versioning system for state a training run never mutates.

## API

See [docs/API.md](API.md#phase-10--automatic-website-update-engine-api)
for the full route list. `monitor.routes.ts` carries the same internal
`x-api-key` + rate-limit admin gate every other business-data route in
this product uses (knowledge/training/connector); `monitorWebhook.routes.ts`
is deliberately public-reachable (a webhook has no way to hold an internal
API key) and gates on HMAC signature verification instead.

## Security posture

- Read-only crawling and least privilege carried forward unchanged from
  Phase 2 — this phase adds no new website-mutating capability anywhere.
- Every inbound webhook request is HMAC-verified against the raw request
  body before any parsing/business logic runs; a missing or invalid
  signature is rejected before `DATABASE_URL`/installation lookups even
  happen.
- Outbound webhook notification delivery goes through `safeFetch` (the
  same SSRF-guarded entry point every other outbound call in this product
  uses) — an admin-configured webhook URL is still an arbitrary outbound
  destination.
- Notification delivery failures (a bad SMTP config, an unreachable
  webhook URL) never lose the underlying `Notification` row or block
  other channels — each channel is attempted independently and its
  outcome recorded via `NotificationDelivery`.

## Known limitations (honest, not hidden)

- **`JobQueue` is built and tested but not yet the execution path for any
  caller** — see "Background Job System" above.
- **Sitemap/robots.txt history starts from this phase's first crawl going
  forward** — historical `CrawlJob` rows created before this migration
  have `sitemapUrls`/`robotsTxtContent` as `null`, so the very first
  comparison report generated for an installation that already had prior
  crawls treats sitemap/robots as unchanged (nothing to compare against),
  not as a false "everything was removed."
- **Config and connector rollback are out of scope** — see "Training-run-level
  Rollback" above.
- **Scheduled recrawls are in-process** and do not survive a restart mid-
  countdown the way a distributed job queue would — the schedule
  *definition* does (see "Scheduled Recrawling"), consistent with every
  other in-process mechanism this codebase already documents this way.
