#!/usr/bin/env bash
# Update Manager — safely updates an existing Docker Compose installation
# to the latest code on the configured git branch. There is no central
# SaaS update server for this self-hosted product (by design — see
# docs/DEPLOYMENT.md) — "version checking" here means comparing this
# checkout's current commit against `git fetch`'s view of the remote,
# which is the honest, real mechanism a self-hosted, git-deployed product
# has available.
#
# Flow: check for updates -> backup -> tag current images as rollback
# targets -> pull -> rebuild -> migrate (automatic, in the backend
# entrypoint) -> restart -> health-check -> roll back automatically on
# failure.
#
# Usage: deploy/scripts/update.sh [--branch main] [--yes] [--force]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy"
ENV_FILE="$REPO_ROOT/.env"

BRANCH="main"
ASSUME_YES="false"
FORCE="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="$2"; shift 2 ;;
    --yes) ASSUME_YES="true"; shift ;;
    --force) FORCE="true"; shift ;;
    -h|--help)
      echo "Usage: $0 [--branch <name>] [--yes] [--force]"
      echo "  --force  proceed even if the working tree has uncommitted local changes"
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

log()  { echo "[update] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
fail() { echo "[update] ERROR: $*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found — this doesn't look like an existing installation. Run install.sh first."
cd "$REPO_ROOT"

if [ ! -d .git ]; then
  fail "Not a git checkout — update.sh only supports git-based deployments (see install.sh's own note on how this product is expected to be deployed). For a non-git deployment, update manually: replace the source tree, then run 'cd deploy && docker compose up -d --build'."
fi

if [ "$FORCE" != "true" ] && [ -n "$(git status --porcelain)" ]; then
  fail "Uncommitted local changes detected in the working tree. Commit/stash them first, or re-run with --force to proceed anyway (uncommitted changes will be OVERWRITTEN by the update)."
fi

# ── Step 1: check for updates ────────────────────────────────────────────
log "Step 1/6: checking for updates on branch '$BRANCH'..."
git fetch origin "$BRANCH" --quiet
LOCAL_REV="$(git rev-parse HEAD)"
REMOTE_REV="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL_REV" = "$REMOTE_REV" ]; then
  log "Already up to date (${LOCAL_REV:0:12}). Nothing to do."
  exit 0
fi

log "Update available: ${LOCAL_REV:0:12} -> ${REMOTE_REV:0:12}"
git log --oneline "$LOCAL_REV..$REMOTE_REV" | sed 's/^/[update]   /'

if [ "$ASSUME_YES" != "true" ]; then
  read -r -p "Proceed with update? [y/N] " CONFIRM
  case "$CONFIRM" in
    y|Y|yes|YES) : ;;
    *) log "Aborted by user."; exit 0 ;;
  esac
fi

# ── Step 2: pre-update backup (safety net for rollback) ─────────────────
log "Step 2/6: taking a pre-update backup..."
"$SCRIPT_DIR/backup.sh" "pre-update-${LOCAL_REV:0:12}" || fail "Pre-update backup failed — aborting update without touching anything. Fix the backup issue and retry."

# ── Step 3: tag current images as the rollback target ────────────────────
log "Step 3/6: tagging current images as rollback targets..."
docker tag "kvl-backend:latest" "kvl-backend:rollback" 2>/dev/null || log "No existing kvl-backend:latest image to tag (first update after a source-only install?) — rollback-by-image-tag won't be available if this update fails; the pre-update backup above is still the safety net."
docker tag "kvl-frontend:latest" "kvl-frontend:rollback" 2>/dev/null || true
PRE_UPDATE_REV="$LOCAL_REV"

rollback_to_previous() {
  log "Rolling back: restoring code to ${PRE_UPDATE_REV:0:12} and running the previously-tagged images..."
  git reset --hard "$PRE_UPDATE_REV"
  (cd "$DEPLOY_DIR" && IMAGE_TAG=rollback docker compose --env-file "$ENV_FILE" up -d --no-build)
  log "Rollback complete — running ${PRE_UPDATE_REV:0:12}'s images again. Restore data from the pre-update backup manually if the update had already altered the database before this rollback ran: deploy/scripts/restore.sh --list"
}

# ── Step 4: pull + rebuild ─────────────────────────────────────────────────
log "Step 4/6: pulling ${REMOTE_REV:0:12} and rebuilding images..."
git reset --hard "$REMOTE_REV"
if ! (cd "$DEPLOY_DIR" && IMAGE_TAG=latest docker compose --env-file "$ENV_FILE" build); then
  log "ERROR: build failed."
  rollback_to_previous
  fail "Update aborted — rolled back to ${PRE_UPDATE_REV:0:12}."
fi

# ── Step 5: restart (migrations run automatically in the backend entrypoint) ─
log "Step 5/6: restarting services with the new images..."
(cd "$DEPLOY_DIR" && IMAGE_TAG=latest docker compose --env-file "$ENV_FILE" up -d)

# ── Step 6: health verification, with automatic rollback on failure ─────────
log "Step 6/6: verifying health..."
ATTEMPTS=0
MAX_ATTEMPTS=30
until curl -fsS "http://127.0.0.1/health" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    log "ERROR: backend did not become healthy after $((MAX_ATTEMPTS * 5))s post-update."
    rollback_to_previous
    fail "Update aborted — rolled back to ${PRE_UPDATE_REV:0:12}. Check what changed with: git log ${PRE_UPDATE_REV}..${REMOTE_REV}"
  fi
  sleep 5
done

log "Update complete: now running ${REMOTE_REV:0:12}. Health check passed."
