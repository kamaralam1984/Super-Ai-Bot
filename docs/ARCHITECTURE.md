# Architecture

## Overview

npm-workspaces monorepo with three packages:

```
Super Ai Bot/
├── shared/     @kvl/shared    — TypeScript types shared by backend + frontend
├── backend/    @kvl/backend   — Express API + WebSocket install orchestrator
├── frontend/   @kvl/frontend  — React installer wizard (Vite + Tailwind)
├── docs/                      — this documentation
└── .env                       — generated + hand-set configuration (gitignored)
```

At install time, the backend also creates twelve runtime data directories at
the repository root (`APP_ROOT`, resolved from `__dirname` so it's identical
regardless of process working directory): `logs/`, `storage/`, `cache/`,
`uploads/`, `models/`, `embeddings/`, `knowledge/`, `config/`, `backups/`,
`plugins/`, `connectors/`, `temp/`.

## Backend module map

```
backend/src/
├── config/
│   ├── env.ts            boot-time env validation (zod) — PORT, INSTALLER_PORT, DATABASE_ADMIN_URL
│   └── paths.ts           APP_ROOT / BACKEND_ROOT / ENV_FILE_PATH / LOGS_DIR — single source of truth
├── utils/
│   ├── logger.ts          Winston structured logger → logs/installer.log (JSON lines)
│   ├── shell.ts            safe CLI probing (execFile, never a shell string)
│   ├── network.ts          TCP port checks, public IP, internet connectivity
│   ├── diskSpace.ts        `df -kP` based free-space reader
│   ├── docker.ts            shared Docker install/running detector
│   ├── osInfo.ts            /etc/os-release parser
│   ├── ssl.ts               local TLS certificate detection (installer's own host)
│   ├── tlsProbe.ts          remote TLS certificate probing (customer's website)
│   ├── httpProbe.ts         native-fetch wrapper with timeout + redirect control
│   ├── firewall.ts          ufw / firewalld detection
│   ├── pgIdentifier.ts      DDL-safe identifier/literal escaping for Postgres
│   ├── envFileWriter.ts     merges + writes .env (0600), applies to process.env live
│   └── readLogs.ts          tails logs/installer.log for the API
├── services/                one service per installer step (see below)
├── routes/                  one Express router per step, mounted under /api
├── middleware/errorHandler.ts   AppError + centralized JSON error responses
└── ws/socket.ts             Socket.IO server, one room per client (socket.id)
```

| Step | Service | Route |
|---|---|---|
| 1. System Requirement Check | `systemCheck.service.ts` | `GET /api/system-check` |
| 2. Environment Validation | `environment.service.ts` | `GET /api/environment` |
| 3. Website URL Validation | `websiteValidation.service.ts` | `POST /api/website-validation` |
| 4. Configuration | `config.service.ts` | `POST /api/configuration` |
| 5. Security | `security.service.ts` (used by Config Manager) | — |
| 6. Database Initialization | `database.service.ts` | `POST /api/database/initialize`, `GET /api/database/status`, `POST /api/database/rollback` |
| 7. Directory Structure | `directory.service.ts` | `POST /api/directories` |
| 8+9. Progress Engine | `installOrchestrator.service.ts` | `POST /api/install/start` (+ WebSocket events) |
| 10+11. Audit trail / logs | `installationRecord.service.ts` | `GET /api/logs` |

Each service is independently callable via its own REST endpoint (so the
wizard UI can validate one step at a time) **and** composed together by
`installOrchestrator.service.ts`, which re-runs the whole pipeline once more
as a single real-time, WebSocket-driven installation run — this is why the
Installing screen re-checks the server and re-validates the website even
though the user already saw green checks earlier: it's the actual
install, not a replay of cached results.

## Frontend module map

```
frontend/src/
├── lib/
│   ├── api.ts        typed fetch wrapper over the REST API
│   └── socket.ts      socket.io-client singleton
├── hooks/useTheme.ts   dark/light mode (localStorage + prefers-color-scheme)
├── components/         GlassPanel, ThemeToggle, StatusIcon, CheckList, PrimaryButton, StepNav, ProgressBar
└── pages/
    ├── InstallWizard.tsx      top-level state machine
    └── steps/
        ├── WelcomeStep.tsx
        ├── SystemCheckStep.tsx
        ├── EnvironmentStep.tsx
        ├── WebsiteFormStep.tsx
        ├── InstallingStep.tsx   real-time progress via WebSocket
        ├── CompletionStep.tsx
        └── ErrorStep.tsx        Step 10 error recovery + log viewer
```

## Data flow for a full install

1. Wizard collects **Website Name** + **Website URL** (`WebsiteFormStep`, after independent System Check / Environment screens).
2. `InstallingStep` connects a WebSocket, then calls `POST /api/install/start` with its own `socket.id`.
3. The route fires `runInstallation()` **without awaiting it** and returns `{ started: true }` immediately — all real progress streams back over `install:progress` / `install:error` events scoped to that one socket's room.
4. `runInstallation()` re-runs System Check → Environment Validation → Website Validation → Configuration (+ Security) → Database → Directories → Finalizing, emitting one event per phase transition.
5. Once the database exists, an `Installation` row + `SecretFingerprint` rows + the full `InstallProgressEvent` log are written into **that installation's own database** (see [DATABASE.md](DATABASE.md)) — the bookkeeping lives with the product it describes, not in a separate global tracker.
6. On success, the wizard shows the Completion screen. On failure, `ErrorStep` shows the failing step, a suggested fix, a Retry button, and an on-demand log viewer backed by `GET /api/logs`.
