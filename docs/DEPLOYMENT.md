# Deployment, Testing, and Operations

## Supported environments

Ubuntu 22.04+, Ubuntu 24.04+, Debian, generic Linux, Docker/Docker Compose,
Cloud VPS, Dedicated Server, Local Server. Kubernetes is not built here —
this deployment targets single-node Docker Compose (the primary,
fully-automated path) and bare-metal/systemd (a supported, more manual
path); see "Known limitations" below.

## What this is, and the one architectural fact everything else follows from

This product is a single Node.js backend process (REST API + WebSocket +
AI engine + website scanner + connector engine + every background job) and
a static frontend bundle — a decision made and repeatedly documented
starting in Phase 2 (`retrain/retrainScheduler.ts`, `monitor/jobs/jobQueue.ts`),
not something this deployment phase introduces. A natural reading of "Docker
Deployment: Frontend / Backend / AI Engine / Website Scanner / Connector
Engine / PostgreSQL / Redis / Vector Database / Nginx / Background Workers"
as one container per bullet would mean splitting a deliberately-monolithic
process into microservices — a real architectural rewrite, not a deployment
concern. Same for "Vector Database": it's an embedded, file-based HNSW
index (`knowledge/vector/vectorStore.ts`, Phase 3's own documented choice),
not a database server — there is nothing to containerize separately; it's
a mounted volume.

**What Docker Compose actually runs**: `frontend` (static SPA, its own
nginx), `backend` (the one process, everything above lives here),
`postgres`, `redis`, `nginx` (the public reverse-proxy edge), `certbot`
(cert renewal). Backup runs in-process inside `backend` on its own cron
schedule — see "Backup Manager" below for why that's not a separate
container either.

## Folder structure

```
deploy/
├── docker/
│   ├── backend.Dockerfile          Multi-stage: build → prod deps → runtime
│   ├── backend-entrypoint.sh       Waits for Postgres, runs `prisma migrate deploy`, then starts
│   ├── frontend.Dockerfile         Multi-stage: Vite build → nginx:alpine serve
│   └── frontend.nginx.conf         Frontend container's own (internal) nginx config
├── nginx/
│   ├── nginx.conf                  Main config: gzip, rate-limit zones, proxy cache
│   └── conf.d/
│       ├── http-only.conf.template   Active before a domain/cert exists
│       ├── https.conf.template       Active after ssl-init.sh succeeds
│       ├── kvl-locations.conf        Shared proxy/location logic (included by both above)
│       └── kvl-proxy-headers.conf    Shared proxy_set_header block
├── monitoring/
│   ├── prometheus.yml              Scrape config for the optional overlay
│   └── grafana-datasource.yml      Auto-provisioned Prometheus datasource
├── systemd/
│   └── kvl-backend.service         Non-Docker (bare-metal) process supervision
├── scripts/
│   ├── install.sh                  One-click Ubuntu/Debian + Docker installer
│   ├── update.sh                   Safe update: backup → build → migrate → health-check → auto-rollback
│   ├── backup.sh                   Thin wrapper around the in-process Backup Manager
│   ├── restore.sh                  Restore Manager (host-orchestrated, destructive)
│   ├── ssl-init.sh                 First Let's Encrypt certificate request
│   └── configure-firewall.sh       Optional ufw setup (not run automatically)
├── docker-compose.yml              Production stack
├── docker-compose.monitoring.yml   Optional Prometheus+Grafana overlay
└── .env.docker.example             Docker-specific env var reference

backend/src/deployment/
├── health/healthCheckEngine.ts     Post-deployment health checks (12 dimensions)
├── monitoring/metrics.ts           Prometheus /metrics endpoint
├── update/updateStatus.service.ts  Version reporting
├── backup/                         Backup Manager (planner + record service + orchestrator)
├── restore/                        Restore Manager
├── plugins/                        Plugin Management
├── license/                        License Management
└── cli/                            Scripts invoked via `docker compose exec backend node dist/...`
```

## Docker Deployment

See `deploy/docker-compose.yml`. Every service has a `restart:
unless-stopped` policy and (for backend/frontend/nginx) a real
`HEALTHCHECK`. Named volumes back every one of
`backend/src/config/paths.ts`'s `RUNTIME_DIRECTORIES` individually — one
volume per directory, never one volume mounted at multiple paths (which
would alias unrelated directories together).

**Two real, code-level production-readiness fixes landed as part of this
phase**, not deployment config alone: `@xenova/transformers`'s embedding
model cache and `tesseract.js`'s OCR language-pack cache both defaulted to
paths *inside `node_modules`* — meaning every container recreate
re-downloaded ~90MB+ of model weights, a real problem for a self-hosted
product that may run with restricted outbound internet after initial setup.
Both are now redirected into the persistent `models/` runtime directory
(`knowledge/embed/embeddings.ts`, `scanner/ocr/ocrEngine.ts`).

## Ubuntu Installer

`deploy/scripts/install.sh` — run as root from an already-cloned checkout
of this repository (see the script's own header comment for why "download
the source" isn't itself part of what an installer for source-shipped
enterprise software does). Checks OS/RAM/disk/internet, installs
Docker+Compose via Docker's official apt repo if missing, creates a system
user, creates+chowns every runtime directory, generates `.env` (same CSPRNG
strength as `security.service.ts`, via `openssl rand`), brings the stack
up, requests a certificate if `--domain` is given, finalizes the
`Installation` DB row (via `deployment/cli/dockerInstallFinalize.ts`, which
reuses `installationRecord.service.ts` rather than reimplementing it), and
verifies `/health`. Rolls back (`docker compose down`) on failure, leaving
generated files in place for troubleshooting rather than deleting them.

**Why the browser Installer Wizard (Phase 1) isn't used for Docker
installs**: that wizard's system-check/environment/configuration steps
probe `127.0.0.1` for Postgres/Redis/nginx and write `DATABASE_URL` as
`postgresql://...@localhost:5432/...` — correct for the bare-metal path
that wizard was built for, meaningless/wrong inside a container where
Postgres is reachable at the `postgres` Compose service name instead.
Rather than bolt Docker-awareness onto Phase 1's wizard (real regression
risk to already-shipped, tested code) or fork it, `install.sh` does the
equivalent work itself, Docker-appropriately, and finalizes the same
`Installation`/`SecretFingerprint` audit rows through the same service
functions. A bare-metal install still uses the original browser wizard,
unchanged (see "Bare-metal / manual deployment" below).

## Nginx Configuration

`deploy/nginx/` — reverse proxy, HTTPS termination, gzip compression,
proxy caching for the SPA's hashed static assets, security headers
(`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`), two rate-limit zones (general API vs. the installer
surface), WebSocket upgrade support (Socket.IO), and an `upstream` block
already shaped for load balancing (add a second `server` line — see the
template's own comment). `/metrics` is deliberately never proxied here —
see "Monitoring" below.

## SSL Management

`deploy/scripts/ssl-init.sh` — one-time first-certificate issuance via
certbot's webroot HTTP-01 challenge, then switches nginx from
`http-only.conf.template` to `https.conf.template`. Renewal is fully
automatic afterward: the `certbot` service in Compose runs `certbot renew`
twice daily (Let's Encrypt's own recommended cadence), and the `nginx`
service reloads itself every 12h to pick up a renewed certificate — nginx
loads TLS certs into worker memory once, not per-request, so a renewal
elsewhere is invisible until a reload happens. Deliberately does **not**
share the Docker socket between containers to trigger this on-demand;
zero-trust posture treats that as a real privilege-escalation risk not
worth the up-to-12h-faster reload it would buy (same reasoning documented
in `docker-compose.yml`'s `nginx` service and Update Manager below).

## Automatic Updates

`deploy/scripts/update.sh` — git-based (this product has no SaaS update
server; "version checking" means `git fetch` + comparing the local commit
against `origin/<branch>`). Flow: check for updates → pre-update backup
(the real rollback safety net) → tag current images `:rollback` → pull +
rebuild → restart (migrations apply automatically via
`backend-entrypoint.sh`) → health-check → **automatic rollback** (git reset
+ re-run the `:rollback`-tagged images) if the health check fails.
"Near-zero-downtime," stated honestly: container recreation typically takes
a few seconds, not milliseconds — true zero-downtime blue/green would need
multiple backend replicas behind the load balancer, out of scope for a
default single-node install (the nginx upstream block is already shaped
for that future, see above).

The backend's role in updates is reporting only
(`deployment/update/updateStatus.service.ts` exposes `GET
/api/deployment/version`) — actually pulling/rebuilding/restarting requires
Docker-host access no container in this stack is given, by design.

## Backup Manager

`backend/src/deployment/backup/` — runs **in-process inside the `backend`
container**, on the same in-process `CronRuntime` Phase 10's Scheduled
Recrawling already uses (`backupScheduler.service.ts`), not a separate
container. `backupService.ts` shells out to `pg_dump` (custom format) and
`redis-cli --rdb`, then tars every directory in `backupPlanner.ts`'s
`BACKUP_INCLUDED_DIRECTORIES` (storage, knowledge, embeddings, config,
uploads, plugins, connectors, logs — deliberately excludes `models`/`cache`/
`temp`, which hold re-downloadable caches or transient state, not user
data) into one `.tar.gz` under `backups/`, sha256-checksummed. A
`BackupRecord` row is written for every attempt, including failed ones — a
gap in backup history should be visible, not silently absent.
`selectBackupsToPrune` (pure, tested) enforces `BACKUP_RETENTION_DAYS`
while always keeping at least the single most recent completed backup,
regardless of age — a retention sweep must never be able to prune a backup
system down to zero.

`postgresql-client-16` is installed in the backend image via PGDG's own apt
repo, not Debian's default `postgresql-client` package — pinned to major
version 16 to exactly match `docker-compose.yml`'s `postgres:16-alpine`,
since `pg_dump` is not reliably forward-compatible with a newer server than
itself.

## Restore Manager

`backend/src/deployment/restore/` + `deploy/scripts/restore.sh` —
destructive, host-orchestrated, requires explicit confirmation. Verifies
the archive's sha256 checksum against the `BackupRecord` before touching
anything (skipped, loudly, only if the database itself is unreachable —
exactly the disaster-recovery case where verification would otherwise
block recovery entirely). Flow: stop `backend` → one-off `backend`
container restores Postgres (`pg_restore --clean --if-exists`) + every
archived directory in place → **Redis restore happens on the host**, not
inside any container: `restore.sh` bridges the `backend_temp` and
`redis_data` named volumes via a throwaway `alpine` container (the only way
to move data between two volumes without either service container needing
access to the other's — the same zero-trust boundary Update Manager and
nginx's reload loop already draw) → restart everything → health-check.

## Monitoring

`GET /metrics` (Prometheus format, via `prom-client`) — Node process
metrics (CPU, memory, event loop lag, GC) plus `kvl_http_requests_total`/
`kvl_http_request_duration_seconds` labeled by route *pattern* (never the
raw URL — unbounded label cardinality is exactly the mistake that makes a
metrics endpoint dangerous at scale), and four on-demand gauges computed
fresh on every scrape: `kvl_disk_free_bytes`, `kvl_database_up`,
`kvl_redis_up`, `kvl_background_jobs_queued` (PENDING/RUNNING counts from
Phase 10's `BackgroundJob` table — queue depth). Together with the process
metrics above, this covers CPU/memory/disk/API/DB/Redis/queue-workers from
the spec's Monitoring list. **Never proxied by the public nginx edge** —
a Prometheus scraper reaches `backend:4500/metrics` directly over the
internal Docker network, the same "not everything on the internal network
needs to be internet-reachable" boundary Postgres/Redis already have (no
exposed host ports). `deploy/docker-compose.monitoring.yml` is an optional
overlay (Prometheus + Grafana, Grafana bound to `127.0.0.1` only) —
genuinely optional infrastructure, not every self-hosted install wants a
full metrics stack running.

**Stated honestly**: per-Docker-container CPU/memory and host network
throughput are *not* covered — this process can only introspect itself,
not sibling containers or host network interfaces, without Docker-socket
or host-network access this deployment's zero-trust posture doesn't grant
any container (the same boundary drawn everywhere else — see
`docker-compose.yml`'s `nginx` service comment). A real container-level
view needs `cAdvisor` or `node_exporter` as an additional Prometheus
scrape target; not wired up by default, since that's a real, separate
piece of infrastructure to opt into, not something fakeable with a metric
that would always read 0.

`GET /api/deployment/health` — the Health Check Engine
(`deployment/health/healthCheckEngine.ts`), distinct from Phase 1's
`systemCheck.service.ts` (which probes the bare host *before* install) and
from the simple `GET /health` liveness probe Docker/nginx/install.sh poll
(kept fast and simple on purpose — this detailed report can take a few
hundred ms and must never be what a container orchestrator's healthcheck
loop depends on). Checks: Backend, Frontend, Database, Redis, Vector Index,
Storage, SSL (real TLS handshake against the public `DOMAIN`, not a local
file check — the backend container has no access to `/etc/letsencrypt`,
only `nginx`/`certbot` do), Internet, AI Engine (LLM config presence),
Scanner (headless renderer configured), Knowledge Base, Connectors (reuses
`Connector.status`/`healthScore` Phase 5/9 already maintain — no duplicate
live probing).

## Plugin Management

`backend/src/deployment/plugins/` — full lifecycle (install/enable/
disable/remove/health), a validated `plugin.json` manifest format
(`pluginManifest.ts`, pure, tested) with a least-privilege, read-only
permission model scoped to the same business-data categories Phase 7's
Permission Engine already governs. **Stated honestly, not hidden**: this
covers registration and lifecycle only. No plugin code is ever
`require()`'d or executed anywhere in this codebase — running third-party
code safely inside this process needs a real isolation strategy (a worker
thread or separate process enforcing the declared `permissions` as actual
capability boundaries), which is a substantial, security-critical
undertaking on its own. Shipping an unsandboxed `require(entryPoint)` here
would be actively dangerous to call "production-ready," not a shortcut
worth taking. The manifest format and registry are genuinely
marketplace-ready: a future marketplace only needs to drop a validated
directory into `plugins/` and call the existing `installPlugin`.

## License Management

`backend/src/deployment/license/` — local, offline Ed25519 signature
verification (`licenseValidator.ts`, pure, tested with a real generated
keypair). **Not a SaaS license server** — consistent with this product's
"NOT a SaaS platform" positioning, there is no server anywhere for a
license check to call, by design. A license file is a signed JSON payload
(`{ payload, signature }`); verifying it is one public-key signature check
against bytes already in hand. Machine binding
(`machineFingerprint.ts`, hashes `/etc/machine-id` + hostname) happens at
the *vendor's* issuance step, not server-side re-signing (this server never
holds the private key) — the flow is: customer runs
`deployment/cli/printMachineFingerprint.js`, sends the vendor that value,
the vendor's offline `deployment/cli/signLicense.js` bakes it into the
signed file it issues, and *that's* what "offline activation" means here —
there is no other mode to build, because nothing in this system ever needs
to phone home. `deployment/cli/generateLicenseKeypair.js` produces a fresh
keypair for a real commercial deployment; the codebase's own baked-in
default public key is explicitly documented as public knowledge (its
matching private key is not committed anywhere, but was necessarily shown
once to seed the constant) — never treat it as secret, generate your own
before shipping commercially.

## Recovery System

- **Automatic Restart / Crash Recovery**: `restart: unless-stopped` on
  every Compose service, each with a real Docker `HEALTHCHECK`.
  **Stated honestly**: Docker Compose (non-Swarm) restarts a container on
  *exit*, not automatically on a failing-but-still-running healthcheck —
  a well-known Compose limitation, not something this phase papers over.
  `docker ps` surfaces an unhealthy-but-alive container for an operator to
  act on; a tool like `docker-autoheal` (which needs Docker-socket access)
  is a documented, deliberate opt-in an operator can add, not baked into
  the default stack given this deployment's consistent zero-trust stance
  on socket sharing.
- **Bare-metal / systemd**: `deploy/systemd/kvl-backend.service` —
  `Restart=on-failure` with a capped restart burst (5 per 60s, so a
  genuinely broken deploy fails loudly instead of respawning forever),
  hardened (`NoNewPrivileges`, `ProtectSystem=strict`, explicit
  `ReadWritePaths`), logs to journald (the app's own winston transport
  already writes structured JSON to stdout, same content `docker compose
  logs backend` would show). **Stated honestly**: this is real, usable
  scaffolding for a non-Docker deployment, not a second fully-automated
  installer — install.sh's one-click path is Docker-only; a native
  install is a supported, documented, more manual path (see below).
- **Rollback**: Update Manager (above) and Restore Manager (above).
- **Database Recovery**: Restore Manager's `pg_restore` path; Postgres
  itself also has `restart: unless-stopped`.

## Security Configuration

Secret generation (`security.service.ts`) was already fully built in Phase
1 — reused as-is (same CSPRNG strength/pattern) for every new
Docker-specific secret (`DB_PASSWORD`, `REDIS_PASSWORD`,
`GRAFANA_ADMIN_PASSWORD`) rather than inventing a second generation
scheme. `deploy/scripts/configure-firewall.sh` configures `ufw`
(default-deny-inbound, SSH+HTTP+HTTPS only) — **not run automatically** by
install.sh, since an automated firewall change on an unconfirmed SSH port
risks locking an operator out of their own server; this is a real,
working, but deliberately opt-in script.

## Testing Strategy (Phase 11)

Every pure module (`backupPlanner.ts`, `pluginManifest.ts`,
`licenseValidator.ts`) has a real Vitest suite — `licenseValidator.test.ts`
signs/verifies with a genuinely generated Ed25519 keypair (not mocked
crypto), and this test suite caught a real bug during development
(`evaluateLicense` wasn't accepting a configurable public key, silently
defaulting to production config — impossible to test in isolation until
fixed). The impure orchestration layer (`backupService.ts`,
`restoreService.ts`, `pluginService.ts`, `licenseService.ts`,
`healthCheckEngine.ts`) has no dedicated test file, matching this
codebase's existing convention for every other Prisma/filesystem/
network-touching service (`scanRecord.service.ts`, `systemCheck.service.ts`,
...) — instead verified via real, live smoke testing during development:
the actual server was started, `/api/deployment/health` was hit and
returned real DB/Redis/vector-index/internet results, `/metrics` returned
real Prometheus output, and the auth gate was confirmed to reject an
unkeyed request with a real `401`.

**Stated honestly**: Docker/Compose/Nginx/systemd files themselves were
*not* built-and-run in this environment (no Docker daemon available here)
— they were validated via what *is* available and meaningful: `nginx -t`
against both the HTTP-only and HTTPS config variants with real (throwaway)
certificate files, Python's `yaml` parser against every Compose/Prometheus/
Grafana YAML file, and `bash -n` syntax-checking every shell script. This
is the same honesty precedent Phase 9 set for its own untested-against-
live-infrastructure paths (SOAP/mTLS/OIDC) — real static verification,
clearly distinguished from live infrastructure testing that wasn't
possible here.

## Known limitations (honest, not hidden)

- **No fully-automated bare-metal installer** — `install.sh` is Docker-only;
  see "Bare-metal / manual deployment" below.
- **Plugin code execution does not ship** — see "Plugin Management."
- **No `docker-autoheal`-style auto-restart-on-unhealthy** in the default
  stack — see "Recovery System."
- **True zero-downtime (blue/green) updates are not implemented** — see
  "Automatic Updates."
- **License Management has no revocation-list distribution mechanism** —
  a `REVOKED` status exists, but nothing sets it automatically without a
  network call this system deliberately doesn't make; there is no
  phone-home to revoke from, consistent with "not a SaaS platform."
- **Docker/Compose files were validated statically, not run against a
  live Docker daemon** in this environment — see "Testing Strategy."
- **No Kubernetes manifests** — Docker Compose (single-node) is the
  primary, fully-automated path.
- **No per-container CPU/memory or host network-throughput metrics** —
  see "Monitoring"'s own honest disclosure above; `cAdvisor`/`node_exporter`
  are the standard way to add this, not wired up by default.

---

## Bare-metal / manual deployment (no Docker)

```bash
npm install --omit=dev      # prisma & @prisma/client are runtime deps, not dev-only
npm run build                # builds shared, backend, and the frontend static bundle
cp .env.example .env
# Provide DATABASE_ADMIN_URL if not running as root (see docs/ARCHITECTURE.md)
NODE_ENV=production PORT=4000 INSTALLER_PORT=4500 node backend/dist/index.js
```

Open `http://<host>:4500` and complete the browser Installer Wizard (system
check → environment → website → install) — this is Phase 1's original,
unchanged flow; it's the right one for this path since it's checking a
real bare host, not a container.

For process supervision, install `deploy/systemd/kvl-backend.service`
(fill in the real install path/user first):

```bash
sudo cp deploy/systemd/kvl-backend.service /etc/systemd/system/
sudo sed -i "s#/opt/kvl-super-ai-chatbot#$(pwd)#g; s/User=kvl/User=$(whoami)/; s/Group=kvl/Group=$(whoami)/" /etc/systemd/system/kvl-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now kvl-backend
```

For Nginx, adapt `deploy/nginx/conf.d/*.template` — replace the
`server backend:4500;`/`server frontend:8080;` upstream lines (Docker
service names) with `server 127.0.0.1:4500;`, and either serve
`frontend/dist` directly via a `root` + `try_files` block (see
`deploy/docker/frontend.nginx.conf` for the exact pattern) or drop the
`frontend` upstream entirely and let the backend serve it (this product's
`app.ts` already does — see the code block above, "one process, one
port"). Then run `deploy/scripts/ssl-init.sh` as normal (it only assumes
`docker compose exec nginx`/`certbot` are reachable, which still holds if
you're running just those two containers alongside a native
Postgres/Redis/Node).

### Running as root vs. non-root

- **As root** (typical for a fresh VPS): the recommended production path for
  `DatabaseManager` is to shell out to `sudo -u postgres psql` for role/
  database creation, so no superuser password is ever stored on disk. (The
  current codebase uses the `DATABASE_ADMIN_URL` connection-string strategy,
  which also works as root — pointing it at a local Postgres superuser
  connection — and is what Phase 1 was developed and tested against.)
- **Non-root** (e.g. shared dev boxes, containers without root): set
  `DATABASE_ADMIN_URL` to a Postgres role with `CREATEROLE`/`CREATEDB`.

## Phase 1 testing plan (installer wizard)

This system was built and verified with real infrastructure at every step —
no mocked data anywhere in the checks themselves:

1. **Unit-level verification (per step, via its own endpoint)** — each of
   `system-check`, `environment`, `website-validation`, `configuration`,
   `database/*`, `directories` was called directly and its output checked
   against the real host: actual CPU/RAM/disk numbers, actual OS release,
   actual DNS/TLS results against `github.com`, an actual PostgreSQL
   role/database created and dropped, actual directories created on disk
   with `0750` permissions verified via `stat`.
2. **Full pipeline, headless browser** — the wizard was driven end-to-end
   with a real Chromium instance (Welcome → System Check → Environment →
   Website Form → Installing → Completion), against both the Vite dev
   server (with the backend proxied) and the actual production build served
   from a single port, confirming no console errors and a real
   `Installation Successful` completion.
3. **Failure path** — an install was started against an unresolvable domain
   to confirm the orchestrator stops at Website Validation, emits a correct
   `install:error`, and creates **no** database (nothing to roll back yet).
4. **Persistence verification** — after a successful run, the created
   database was queried directly with `psql` to confirm the `installations`,
   `secret_fingerprints` (8 rows, 64-char hashes, no raw values), and
   `installation_logs` (16 rows covering every phase) tables were populated
   correctly.
5. A real StrictMode-only race condition in the WebSocket progress listener
   was found by this process (the install silently never started under
   React 18 StrictMode's dev-mode double-effect) and fixed — see
   `InstallingStep.tsx`'s `cancelled`-flag pattern.

## Rollback strategy (Phase 1 database step)

See [DATABASE.md](DATABASE.md#rollback-strategy) for the automatic
database-step rollback policy, and [API.md](API.md) for the standalone
`POST /api/database/rollback` endpoint. See "Automatic Updates" and
"Restore Manager" above for the Phase 11 deployment-level rollback paths.

## Performance notes

- Independent checks within a step run concurrently (`Promise.all`), not
  sequentially — e.g. System Check's eleven probes, or Website Validation's
  seven network calls, all fire at once rather than one-at-a-time.
- The install orchestrator streams progress over WebSocket instead of
  blocking a single HTTP request for the full ~2–5 second pipeline duration,
  so the UI stays responsive and can show real incremental progress instead
  of a single spinner.
- `writeEnvFile` merges and rewrites `.env` in one pass and updates
  `process.env` in memory, avoiding a process restart between install steps
  that need freshly-generated configuration.
- Prisma's generated client and migration engine are the only "heavy"
  runtime dependencies; no ORM query is issued until Step 6, and the
  `installation_logs` write is a single batched `createMany`, not one
  insert per log line.
- Nginx caches the SPA's hashed static assets at the edge
  (`proxy_cache_path` in `deploy/nginx/nginx.conf`) and compresses text/JS/
  CSS/JSON responses (`gzip on`), so a repeat asset request never reaches
  the `frontend` container and every API response is transferred
  compressed.
