# Backup & Restore Guide

See [docs/DEPLOYMENT.md](DEPLOYMENT.md#backup-manager) for how the Backup
Manager works internally.

## What's included in a backup

PostgreSQL (full `pg_dump --format=custom`), Redis (RDB snapshot),
`storage/`, `knowledge/`, `embeddings/` (the vector index), `config/`,
`uploads/`, `plugins/`, `connectors/`, `logs/`. **Not** included:
`models/` (re-downloadable embedding-model/OCR-language-pack caches) or
`cache/`/`temp/` (transient). One `.tar.gz` per backup, sha256-checksummed,
under `backups/`.

## Automatic (scheduled) backups

Already running by default — daily at 03:00 UTC
(`BACKUP_SCHEDULE_CRON` in `.env`). Change it and restart the backend to
apply:

```bash
sed -i 's/^BACKUP_SCHEDULE_CRON=.*/BACKUP_SCHEDULE_CRON=0 2 * * */' .env
cd deploy && docker compose restart backend
```

Retention (`BACKUP_RETENTION_DAYS`, default 14) is enforced right after
every scheduled backup completes — backups older than the window are
deleted, except the single most recent one is always kept regardless of
age (a retention sweep can never leave you with zero backups).

## Manual backup

```bash
deploy/scripts/backup.sh my-label
```

Or via the API:

```bash
curl -X POST -H "x-api-key: $API_SECRET" -H "Content-Type: application/json" \
  -d '{"label": "before-big-change"}' \
  http://localhost/api/deployment/backups
```

## Listing backups

```bash
curl -H "x-api-key: $API_SECRET" http://localhost/api/deployment/backups
# or, from the filesystem directly:
deploy/scripts/restore.sh --list
```

## Restoring a backup

**This overwrites your current database and every backed-up directory.**
Read this whole section before running it on a system with data you care
about.

```bash
deploy/scripts/restore.sh --list                        # find the filename you want
deploy/scripts/restore.sh kvl-backup-2026-07-20T03-00-00-000Z-scheduled.tar.gz
```

Requires typing `yes` to confirm (or pass `--yes` to skip, e.g. in a
disaster-recovery script that already got confirmation elsewhere). What
happens:
1. Verifies the archive's checksum against what was recorded at backup
   time — refuses to restore a corrupted/tampered archive (this check is
   skipped, loudly, only if the database itself is unreachable, since
   that's exactly the situation restoring is meant to fix).
2. Stops the `backend` container (no writes during restore).
3. Restores PostgreSQL and every directory via a one-off backend
   container.
4. Restores Redis by bridging volumes on the host (stops `redis`, copies
   the RDB file into its volume, restarts it).
5. Restarts `backend` and verifies `/health`.

If this backup didn't include Redis data (e.g. Redis wasn't reachable at
backup time), that step is skipped and Redis keeps its current state —
noted in the script's output either way, not silent.

## Cloud / off-site backup

Not built directly into this system (this product makes no outbound cloud
API calls by default, consistent with its self-hosted positioning). The
straightforward, honest way to get off-site copies: point any standard
backup-syncing tool (`rclone`, `restic`, a simple `rsync` cron job) at the
`backups/` directory (or its Docker volume, `backend_backups`) — it's
already a directory of complete, checksummed, timestamped archives, ready
for whatever off-site tool you already trust.
