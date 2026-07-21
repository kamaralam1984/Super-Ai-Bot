# Troubleshooting Guide

## Diagnosing anything: start with the detailed health check

```bash
curl -H "x-api-key: $API_SECRET" http://localhost/api/deployment/health | python3 -m json.tool
```

Each of the 12 checks (`backend`, `frontend`, `database`, `redis`,
`vector_index`, `storage`, `ssl`, `internet`, `ai_engine`, `scanner`,
`knowledge_base`, `connectors`) reports `pass`/`warn`/`fail` with a
human-readable `detail` — this is almost always the fastest way to find
which layer is actually broken before digging into logs.

## Install fails at "checking system requirements"

The script prints exactly which requirement failed (RAM/disk/OS
version/internet). These are hard minimums (2GB RAM, 10GB disk) — the
install genuinely will not work reliably below them, this isn't overly
cautious gatekeeping.

## Install fails at "building and starting all services"

```bash
cd deploy && docker compose logs backend
```

Most common causes: the local embedding model (~90MB) or OCR language
packs failed to download on first use (check `internet` connectivity),
or a port conflict (something else already listening on 80/443 — check
with `sudo lsof -i :80`).

## `docker compose exec backend node ...` commands fail with "Cannot find module"

You're likely running against a stale image built before a code change.
Rebuild: `docker compose build backend && docker compose up -d backend`.

## Backend keeps restarting (`docker compose ps` shows "Restarting")

```bash
docker compose logs --tail=100 backend
```

Common causes: `DATABASE_URL`/`REDIS_URL` wrong (shouldn't happen with a
generated `.env`, but check if hand-edited), Postgres/Redis not yet
healthy when the backend's entrypoint tried to connect (the entrypoint
retries for ~60s before giving up — if Postgres is *very* slow to start
on first boot, e.g. a huge existing volume, this can be too short; check
`docker compose logs postgres` for what it's doing).

## SSL certificate request fails

```bash
deploy/scripts/ssl-init.sh yourdomain.com you@example.com
```

Common causes: DNS A record doesn't actually point at this server yet
(`dig +short yourdomain.com` should return this server's public IP), port
80 isn't reachable from the internet (check your cloud provider's
firewall/security group, not just `ufw` on the host), or you've hit Let's
Encrypt's rate limits (5 failures per account/hostname per hour — wait and
retry, don't loop rapidly).

## "Certificate expires in N days" warning from the health check

The `certbot` service should be renewing automatically twice daily once
within ~30 days of expiry. Check it's actually running:
`docker compose logs certbot`. If it's failing, the most common cause is
the same DNS/port-80-reachability issue as initial issuance — Let's
Encrypt re-validates the domain on every renewal, not just the first
issuance.

## A scheduled backup never seems to run

```bash
docker compose logs backend | grep "deployment-backup"
```

Confirm `BACKUP_SCHEDULE_CRON` in `.env` is valid (`validateCronExpression`
logs a clear error at boot if not, and disables scheduling entirely rather
than silently guessing) and that the backend container has actually
restarted since you last changed it.

## Restore fails partway through

`deploy/scripts/restore.sh` stops the backend before touching anything and
does not restart it automatically if the restore step itself fails —
system state may be partially restored at that point. Do not restart
`backend` until you've either fixed the underlying issue and re-run
restore, or decided to restore from a *different* backup instead. The
error output names exactly which step failed (database, or a specific
directory).

## Update rolled back automatically — now what?

The output names the failing health check attempt and the commit range
(`git log <old>..<new>`) — review what changed in that range before
retrying. The pre-update backup taken in step 2 is available if you need
to go back further than the automatic rollback's single-version memory:
`deploy/scripts/restore.sh --list`.

## High memory usage / OOM kills

Check `/metrics` (`kvl_process_resident_memory_bytes`) or
`docker stats backend`. The local embedding model and headless Chromium
(for JavaScript-rendered page scanning) are the two most memory-hungry
components — if you're on the 2GB RAM hard-minimum rather than the 4GB+
recommendation, this is the most likely explanation, not a leak.

## "No knowledge chunks built yet" even after scanning

A scan (`POST /api/scan/start`) only crawls and extracts raw content —
building the actual AI-searchable knowledge base is a separate step
(`POST /api/training/start`, or Phase 6's `/retrain`). See
[docs/SCANNER.md](SCANNER.md) and [docs/AI_TRAINING_ENGINE.md](AI_TRAINING_ENGINE.md).

## Where to look next

- [docs/DEPLOYMENT.md](DEPLOYMENT.md) — full architecture reference
- [docs/SECURITY.md](SECURITY.md) — security model
- [docs/FAQ.md](FAQ.md) — common questions
- `logs/installer.log` / `docker compose logs` / `journalctl -u kvl-backend`
  — structured logs for every component
