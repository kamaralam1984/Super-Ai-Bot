#!/usr/bin/env bash
# Restore Manager — restores a Backup Manager archive
# (deploy/scripts/backup.sh). DESTRUCTIVE: overwrites the current
# database and every backed-up runtime directory. Requires explicit
# confirmation.
#
# Flow: stop the backend (no writes during restore) -> restore database +
# files via a one-off backend container (backend/src/deployment/cli/
# runRestore.js) -> restore Redis by bridging the backup's staged RDB
# file into the redis_data volume (this script runs on the Docker host,
# which is the only place with the privilege to bridge two volumes — see
# restoreService.ts's own comment on why the backend container itself
# deliberately cannot do this) -> restart everything -> verify health.
#
# Usage:
#   deploy/scripts/restore.sh --list
#   deploy/scripts/restore.sh <backup-filename> [--yes]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$SCRIPT_DIR/.."
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

log()  { echo "[restore] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
fail() { echo "[restore] ERROR: $*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found."
cd "$DEPLOY_DIR"

if [ "${1:-}" = "--list" ]; then
  log "Available backups (from /app/backups inside the backend container):"
  docker compose exec -T backend sh -c "ls -la /app/backups 2>/dev/null | grep '.tar.gz' || echo '(none found)'"
  exit 0
fi

FILE_NAME="${1:-}"
ASSUME_YES="false"
[ "${2:-}" = "--yes" ] && ASSUME_YES="true"

if [ -z "$FILE_NAME" ]; then
  fail "Usage: $0 <backup-filename> [--yes]   (or: $0 --list)"
fi

log "!!! THIS WILL OVERWRITE THE CURRENT DATABASE AND ALL DATA DIRECTORIES !!!"
log "Restoring from: $FILE_NAME"
if [ "$ASSUME_YES" != "true" ]; then
  read -r -p "Type 'yes' to proceed: " CONFIRM
  [ "$CONFIRM" = "yes" ] || { log "Aborted."; exit 0; }
fi

log "Step 1/5: stopping backend (preventing writes during restore)..."
docker compose --env-file "$ENV_FILE" stop backend

log "Step 2/5: restoring database + files (one-off backend container)..."
if ! docker compose --env-file "$ENV_FILE" run --rm --no-deps backend node dist/deployment/cli/runRestore.js "$FILE_NAME" --confirm; then
  log "Database/file restore failed — backend remains stopped. Investigate before restarting (system state may be partially restored). See logs above."
  exit 1
fi

log "Step 3/5: restoring Redis (if this backup included it)..."
docker compose --env-file "$ENV_FILE" stop redis
# Bridges backend_temp (holds the staged redis.rdb — see runRestore.js)
# and redis_data via a throwaway container that mounts both — the only
# way to move data between two named volumes without either service
# container needing access to the other's volume. Volume names use
# docker-compose.yml's explicit top-level `name:` (kvl-super-ai-chatbot)
# as their prefix, not the containing directory's name — Compose only
# falls back to the directory name when no explicit project name is set.
PROJECT_NAME="kvl-super-ai-chatbot"
STAGED_CHECK=$(docker run --rm -v "${PROJECT_NAME}_backend_temp:/src" alpine sh -c '[ -f /src/restore-redis.rdb ] && echo yes || echo no')
if [ "$STAGED_CHECK" = "yes" ]; then
  docker run --rm -v "${PROJECT_NAME}_backend_temp:/src" -v "${PROJECT_NAME}_redis_data:/dst" alpine sh -c 'cp /src/restore-redis.rdb /dst/dump.rdb && rm -f /src/restore-redis.rdb'
  log "Redis data restored."
else
  log "This backup did not include Redis data — skipping (Redis keeps its current state)."
fi
docker compose --env-file "$ENV_FILE" start redis

log "Step 4/5: restarting backend..."
docker compose --env-file "$ENV_FILE" start backend

log "Step 5/5: verifying health..."
ATTEMPTS=0
MAX_ATTEMPTS=30
until curl -fsS "http://127.0.0.1/health" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    fail "Backend did not become healthy after restore. Check: docker compose logs backend"
  fi
  sleep 5
done

log "Restore complete and healthy."
