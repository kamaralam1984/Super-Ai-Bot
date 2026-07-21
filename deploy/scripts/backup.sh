#!/usr/bin/env bash
# Backup Manager — host-shell entrypoint. The actual backup logic
# (pg_dump + redis-cli --rdb + tar of the runtime data directories) runs
# inside the backend container, which already has DATABASE_URL/REDIS_URL
# and owns every directory being archived — see
# backend/src/deployment/backup/backupService.ts. This script is a thin,
# convenient wrapper so an operator (or update.sh) doesn't need to
# remember the `docker compose exec` incantation.
#
# Usage: deploy/scripts/backup.sh [label]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$SCRIPT_DIR/.."
LABEL="${1:-manual}"

cd "$DEPLOY_DIR"
docker compose exec -T backend node dist/deployment/cli/runBackup.js "$LABEL"
