#!/usr/bin/env bash
# KVL Super AI Chatbot — one-click Ubuntu/Debian installer.
#
# Assumes it is being run from inside an already-present checkout of this
# repository (a self-hosted enterprise product ships as a downloaded/
# cloned copy of its own source, not fetched from an unspecified URL this
# script would have to guess at) — e.g.:
#   git clone <your private KVL repository URL> kvl-super-ai-chatbot
#   cd kvl-super-ai-chatbot
#   sudo ./deploy/scripts/install.sh --domain chat.example.com --email admin@example.com
#
# Must be run as root (it installs OS packages and creates a system
# user). Every destructive/irreversible action is logged; on failure the
# script rolls back the Docker stack it started (not the OS packages it
# installed — apt packages are not "this install's" state to own/remove).
set -euo pipefail

# ── Argument parsing ─────────────────────────────────────────────────────

DOMAIN=""
EMAIL=""
SKIP_SSL="false"
APP_USER="kvl"
WEBSITE_NAME=""
WEBSITE_URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --skip-ssl) SKIP_SSL="true"; shift ;;
    --app-user) APP_USER="$2"; shift 2 ;;
    --website-name) WEBSITE_NAME="$2"; shift 2 ;;
    --website-url) WEBSITE_URL="$2"; shift 2 ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--domain <domain>] [--email <email>] [--skip-ssl] [--app-user <name>] [--website-name <name>] [--website-url <url>]

  --domain        Public domain name (e.g. chat.example.com). Enables HTTPS
                  via Let's Encrypt. Omit for an IP-only / internal install
                  (serves HTTP only).
  --email         Contact email for Let's Encrypt (required if --domain is set).
  --skip-ssl      Set up the stack over HTTP only, even if --domain is given
                  (e.g. TLS is terminated by an upstream load balancer instead).
  --app-user      System user that owns the installation (default: kvl).
  --website-name  Display name of the business/website this instance serves. Required.
  --website-url   URL of the customer website the AI will scan/chat for. Required.
EOF
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -n "$DOMAIN" ] && [ "$SKIP_SSL" != "true" ] && [ -z "$EMAIL" ]; then
  echo "ERROR: --email is required when --domain is set (Let's Encrypt requires a contact address). Pass --skip-ssl to opt out of HTTPS instead." >&2
  exit 1
fi
if [ -z "$WEBSITE_NAME" ] || [ -z "$WEBSITE_URL" ]; then
  echo "ERROR: --website-name and --website-url are both required. Run with --help for usage." >&2
  exit 1
fi

# ── Setup ─────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy"
ENV_FILE="$REPO_ROOT/.env"
LOG_FILE="$REPO_ROOT/logs/install-$(date +%Y%m%d%H%M%S).log"

mkdir -p "$REPO_ROOT/logs"
exec > >(tee -a "$LOG_FILE") 2>&1

log()  { echo "[install] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
fail() { echo "[install] ERROR: $*" >&2; rollback; exit 1; }

STARTED_COMPOSE="false"
rollback() {
  if [ "$STARTED_COMPOSE" = "true" ]; then
    log "Rolling back: stopping the Docker Compose stack this run started..."
    (cd "$DEPLOY_DIR" && docker compose --env-file "$ENV_FILE" down) || true
    log "Stack stopped. Generated files (.env, deploy/nginx/conf.d/kvl.conf, directories) were left in place for troubleshooting — re-run this script once the underlying issue is fixed."
  fi
}
trap 'fail "unexpected error on line $LINENO"' ERR

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: this script must be run as root (sudo $0 ...)." >&2
  exit 1
fi

# ── Step 1: system requirement checks ──────────────────────────────────────
log "Step 1/9: checking system requirements..."

if [ ! -f /etc/os-release ]; then
  fail "Cannot detect OS (/etc/os-release missing) — this installer supports Ubuntu 22.04+, Ubuntu 24.04+, and Debian."
fi
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu)
    MAJOR_VERSION="${VERSION_ID%%.*}"
    if [ "${MAJOR_VERSION:-0}" -lt 22 ]; then
      fail "Ubuntu ${VERSION_ID:-unknown} detected — this installer requires Ubuntu 22.04 or newer."
    fi
    ;;
  debian) : ;; # supported, no hard minimum version enforced (Docker's own apt repo covers current stable/oldstable)
  *) fail "Unsupported OS '${ID:-unknown}' — this installer supports Ubuntu 22.04+, Ubuntu 24.04+, and Debian." ;;
esac
log "OS: ${PRETTY_NAME:-$ID}"

TOTAL_MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$TOTAL_MEM_MB" -lt 2048 ]; then
  fail "Only ${TOTAL_MEM_MB}MB RAM detected — at least 2GB is required (4GB+ recommended; the local embedding model and OCR engine are memory-intensive)."
elif [ "$TOTAL_MEM_MB" -lt 4096 ]; then
  log "WARNING: ${TOTAL_MEM_MB}MB RAM detected — 4GB+ is recommended for production use."
fi

AVAILABLE_DISK_GB=$(df -BG --output=avail "$REPO_ROOT" | tail -1 | tr -dc '0-9')
if [ "${AVAILABLE_DISK_GB:-0}" -lt 10 ]; then
  fail "Only ${AVAILABLE_DISK_GB:-0}GB free disk space at $REPO_ROOT — at least 10GB is required."
fi
log "Resources OK: ${TOTAL_MEM_MB}MB RAM, ${AVAILABLE_DISK_GB}GB free disk."

if ! ping -c1 -W3 1.1.1.1 >/dev/null 2>&1 && ! ping -c1 -W3 8.8.8.8 >/dev/null 2>&1; then
  fail "No internet connectivity detected — required to install packages and (if --domain is set) request a TLS certificate."
fi

# ── Step 2: install dependencies (Docker + Compose, if missing) ────────────
log "Step 2/9: checking/installing dependencies..."

apt-get update -y

for pkg in curl ca-certificates gnupg openssl; do
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    log "Installing $pkg..."
    apt-get install -y --no-install-recommends "$pkg"
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found — installing via Docker's official apt repository..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  ARCH="$(dpkg --print-architecture)"
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  log "Docker installed: $(docker --version)"
else
  log "Docker already installed: $(docker --version)"
fi

if ! docker compose version >/dev/null 2>&1; then
  fail "Docker Compose plugin is not available even after installation — check the Docker apt repository step above for errors."
fi
log "Docker Compose: $(docker compose version)"

# ── Step 3: application user ────────────────────────────────────────────────
log "Step 3/9: creating application user '$APP_USER'..."
# Explicit --uid/--gid 10001 to match backend.Dockerfile's container-side
# `kvl` user exactly. Without this, useradd assigns the next arbitrary
# free system UID (e.g. 998) — a *different* number from the container's
# hardcoded 10001, and since bind-mounted files (.env, the generated
# nginx vhost, etc.) are permission-checked by raw UID rather than
# username, the container's own process can create/own directories fine
# but can never write back to a host-created file like .env (real
# failure: dockerInstallFinalize.js's "EACCES: permission denied, open
# '/app/.env'" trying to record website-name/url after finalizing).
if ! id "$APP_USER" >/dev/null 2>&1; then
  groupadd --gid 10001 "$APP_USER" 2>/dev/null || true
  useradd --uid 10001 --gid 10001 --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  log "Created system user '$APP_USER' (uid/gid 10001, matching the container)."
else
  log "User '$APP_USER' already exists."
fi
usermod -aG docker "$APP_USER"

# ── Step 4: directories + permissions ───────────────────────────────────────
log "Step 4/9: creating runtime directories..."
# Mirrors backend/src/config/paths.ts's RUNTIME_DIRECTORIES exactly — the
# single source of truth for what the application itself expects to
# exist under its root.
RUNTIME_DIRECTORIES="logs storage cache uploads models embeddings knowledge config backups plugins connectors temp"
for dir in $RUNTIME_DIRECTORIES; do
  mkdir -p "$REPO_ROOT/$dir"
done
chown -R "$APP_USER:$APP_USER" "$REPO_ROOT"
chmod 750 "$REPO_ROOT"
for dir in $RUNTIME_DIRECTORIES; do
  chmod 750 "$REPO_ROOT/$dir"
done
log "Directories created and owned by '$APP_USER'."

# ── Step 5: configuration generation (.env) ─────────────────────────────────
log "Step 5/9: generating configuration..."
if [ -f "$ENV_FILE" ]; then
  log "$ENV_FILE already exists — leaving it untouched (re-running this installer never overwrites existing secrets). Delete it manually first if you want a fully fresh install."
else
  # Same CSPRNG strength/format as backend/src/services/security.service.ts's
  # generateSecrets() (crypto.randomBytes, base64url-equivalent via
  # `openssl rand -base64` with padding stripped) — this script and the
  # HTTP installer wizard produce equally strong secrets, just via
  # different tooling (bash+openssl here, since there's no running Node
  # process yet to call into at this point in a from-scratch Docker install).
  gen_secret() { openssl rand -base64 48 | tr -d '=+/\n' | head -c 64; }
  gen_hex()    { openssl rand -hex 32; }

  APPLICATION_ID="app_$(openssl rand -hex 8)"
  INSTALLATION_ID="inst_$(openssl rand -hex 8)"
  DB_USER="kvl_user_$(openssl rand -hex 4)"
  DB_PASSWORD="$(gen_secret)"
  DB_NAME="kvl_$(openssl rand -hex 6)"
  REDIS_PASSWORD="$(gen_secret)"

  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=4000
INSTALLER_PORT=4500

APPLICATION_ID=$APPLICATION_ID
INSTALLATION_ID=$INSTALLATION_ID
INSTALL_CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

JWT_SECRET=$(gen_secret)
ENCRYPTION_KEY=$(gen_hex)
API_SECRET=$(gen_secret)
WEBHOOK_SECRET=$(gen_secret)
CSRF_SECRET=$(gen_secret)
COOKIE_SECRET=$(gen_secret)
SESSION_SECRET=$(gen_secret)

DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME
REDIS_PASSWORD=$REDIS_PASSWORD

DOMAIN="$DOMAIN"
LETSENCRYPT_EMAIL="$EMAIL"

# Unquoted, this cron expression's spaces and `*` glob characters make
# `source .env`/`set -a; . .env` (this script's own next step, and any
# admin later sourcing the file to debug) try to run `3`, `*`, `*`, `*`
# as separate commands — breaks every time, deterministically, since a
# cron schedule is never going to NOT have spaces and asterisks.
BACKUP_SCHEDULE_CRON="0 3 * * *"
BACKUP_RETENTION_DAYS=14

# Only used if the optional monitoring overlay is enabled later — see
# docs/DEPLOYMENT.md's Monitoring section and deploy/docker-compose.monitoring.yml.
GRAFANA_ADMIN_PASSWORD=$(gen_secret)

# Optional — fill in after install to enable the AI chat engine (docs/CHAT_ENGINE.md)
LLM_PROVIDER=anthropic
LLM_MODEL=
ANTHROPIC_API_KEY=
LLM_BASE_URL=
LLM_API_KEY=

# Optional — fill in to enable email notifications (docs/AUTO_UPDATE_ENGINE.md)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
EOF
  chmod 600 "$ENV_FILE"
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  log "Generated $ENV_FILE (mode 600, owned by $APP_USER)."
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

# ── Step 6: nginx bootstrap config ──────────────────────────────────────────
log "Step 6/9: installing initial nginx configuration..."
if [ -n "$DOMAIN" ] && [ "$SKIP_SSL" != "true" ]; then
  sed "s/\${DOMAIN_OR_UNDERSCORE}/$DOMAIN/g" "$DEPLOY_DIR/nginx/conf.d/http-only.conf.template" > "$DEPLOY_DIR/nginx/conf.d/kvl.conf"
else
  sed "s/\${DOMAIN_OR_UNDERSCORE}/_/g" "$DEPLOY_DIR/nginx/conf.d/http-only.conf.template" > "$DEPLOY_DIR/nginx/conf.d/kvl.conf"
fi

# ── Step 7: start the stack ──────────────────────────────────────────────────
log "Step 7/9: building and starting all services (this can take several minutes on first run)..."
cd "$DEPLOY_DIR"
docker compose --env-file "$ENV_FILE" up -d --build
STARTED_COMPOSE="true"

# ── Step 8: SSL (optional) ───────────────────────────────────────────────────
if [ -n "$DOMAIN" ] && [ "$SKIP_SSL" != "true" ]; then
  log "Step 8/9: requesting a Let's Encrypt certificate for $DOMAIN..."
  "$SCRIPT_DIR/ssl-init.sh" "$DOMAIN" "$EMAIL" || log "WARNING: SSL setup failed — the site remains reachable over HTTP. Re-run deploy/scripts/ssl-init.sh $DOMAIN $EMAIL once DNS/networking is fixed."
else
  log "Step 8/9: skipping SSL (no --domain given, or --skip-ssl set)."
fi

# ── Step 9: health verification ──────────────────────────────────────────────
log "Step 9/9: verifying installation health..."
HEALTH_URL="http://127.0.0.1/health"
ATTEMPTS=0
MAX_ATTEMPTS=30
until curl -fsS "$HEALTH_URL" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    fail "Backend did not become healthy after $((MAX_ATTEMPTS * 5))s. Check logs with: (cd $DEPLOY_DIR && docker compose logs backend)"
  fi
  sleep 5
done
log "Health check passed."

log "Finalizing installation record (website=$WEBSITE_URL)..."
if ! docker compose exec -T backend node dist/deployment/cli/dockerInstallFinalize.js --website-name "$WEBSITE_NAME" --website-url "$WEBSITE_URL"; then
  fail "Failed to finalize the installation record. The stack is running and healthy — retry finalization alone with: (cd $DEPLOY_DIR && docker compose exec backend node dist/deployment/cli/dockerInstallFinalize.js --website-name \"$WEBSITE_NAME\" --website-url \"$WEBSITE_URL\")"
fi

log ""
log "=========================================================="
log " Installation complete."
if [ -n "$DOMAIN" ] && [ "$SKIP_SSL" != "true" ]; then
  log " URL: https://$DOMAIN"
else
  log " URL: http://$(curl -fsS -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
fi
log " The platform is fully configured and ready — no browser setup wizard needed for a Docker install."
log " Full logs for this run: $LOG_FILE"
log "=========================================================="
