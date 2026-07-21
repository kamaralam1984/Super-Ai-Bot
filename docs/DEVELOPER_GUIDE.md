# Developer Guide

## Local development setup

```bash
npm install
cp .env.example .env
npm run build --workspace=shared
npm run dev:backend    # installer/API server on :4500, tsx watch mode
npm run dev:frontend   # Vite dev server on :5173, proxies /api and /socket.io to :4500
```

No Docker needed for day-to-day development — Docker/Compose
(`deploy/`) is a *deployment* concern, not a dev-loop one. Point
`DATABASE_URL`/`REDIS_URL` in `.env` at a local Postgres 16 / Redis 7
(or run just those two via `cd deploy && docker compose up -d postgres redis`
if you don't want to install them natively — the app itself still runs
via `npm run dev:backend`, not in a container, during development).

## Repository layout

```
backend/    Express API + WebSocket + every domain engine (see below)
frontend/   React/Vite SPA (installer wizard + admin surfaces)
shared/     Types shared between backend and frontend
deploy/     Docker/Compose/Nginx/systemd/scripts — see docs/DEPLOYMENT.md
docs/       This directory
```

`backend/src/` is organized by domain, one folder per phase's subject
matter (`scanner/`, `knowledge/`, `training/`, `connector/`, `permission/`,
`chat/`, `monitor/`, `deployment/`, ...), each following the same internal
convention:

- Pure engine modules — no Prisma, no network, no filesystem — fully unit
  tested, real inputs/outputs, no mocking needed because there's nothing to
  mock.
- Exactly one `xxxRecord.service.ts` per domain — the only file that
  touches Prisma. If you're adding a new database read/write, it goes
  here, not scattered across route handlers.
- Exactly one `xxxOrchestrator.service.ts` (or a handful of top-level
  `runXxx()` functions) — composes the pure engines with the record
  service and any other impure edge (filesystem, `child_process`, another
  domain's service). This is the only layer that's allowed to be messy
  glue code; the engines it calls should not be.
- Routes (`backend/src/routes/*.routes.ts`) are thin — validate with Zod,
  call one orchestrator function, shape the response. No business logic
  in a route handler.

Before adding a new domain module or REST surface, **check whether
something already covers most of it** — this codebase has a strong,
repeatedly-applied precedent of auditing for existing infrastructure
before building a parallel system (see any phase doc's "What it does, and
what it deliberately doesn't rebuild" section for examples). Extend in
place; don't duplicate.

## Testing conventions

```bash
npm run test --workspace=backend         # full suite
npx vitest run src/deployment            # one domain
npx vitest run src/deployment/backup/backupPlanner.test.ts   # one file
```

- Pure modules get a real Vitest suite, testing actual behavior with real
  inputs — not mocks of the module's own logic. Where genuine external
  I/O is unavoidable but cheap/deterministic (crypto signing, a local
  embedding model, a real local HTTP/gRPC server), prefer exercising the
  real thing over mocking it; see `licenseValidator.test.ts` (real
  Ed25519 keypairs) and `embeddings.test.ts` (real local model inference)
  for the pattern.
- Impure orchestration/record services generally have **no** dedicated
  test file — this is a deliberate, consistent convention across every
  phase (`scanRecord.service.ts`, `systemCheck.service.ts`,
  `backupService.ts`, ...), not an oversight. Verify them via real
  end-to-end smoke testing during development (start the server, hit the
  real endpoint, check the real response) instead.
- A handful of tests are marked "real network" and hit live third-party
  sites (Shopify, WordPress demo sites, badssl.com, ...) for genuine
  integration coverage. These are known to be occasionally flaky against
  real internet conditions outside this repo's control — a failure in one
  of these specifically (not a `deployment/*` or other in-repo-only test)
  during an unrelated change is very likely pre-existing flakiness, not a
  regression; check whether it fails in isolation / on `main` before
  assuming otherwise.

## Database migrations

This environment's `prisma migrate dev` doesn't work non-interactively.
The supported flow:

```bash
cd backend
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --script > /tmp/migration.sql

mkdir -p prisma/migrations/$(date -u +%Y%m%d%H%M%S)_your_migration_name
cp /tmp/migration.sql prisma/migrations/<that-folder>/migration.sql

npx prisma migrate deploy   # non-interactive apply
npx prisma generate
```

## Adding a new deployment-domain module (`backend/src/deployment/`)

Follow the pattern task #50-56 established: a pure planner (if there's any
non-trivial decision logic — naming, retention, validation), a
`xxxRecord.service.ts` if it needs its own Prisma model, an orchestration
service composing them, and a route in `deployment.routes.ts` behind the
existing `x-api-key` + rate-limit gate. Reuse `MonitorRecordService`'s
`BackgroundJob`/`CronRuntime` infrastructure (Phase 10) for anything
scheduled or job-tracked rather than building a second scheduler — see
`backupScheduler.service.ts` for the pattern.

## Where to read next

Every phase has its own doc under `docs/` explaining what it built and
why, including honest "known limitations" sections — read the one for
whatever domain you're touching before changing it. `docs/DEPLOYMENT.md`
is the entry point for anything infra/ops-related.
