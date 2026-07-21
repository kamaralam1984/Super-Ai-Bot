#!/usr/bin/env bash
# SSL Manager — first-certificate issuance. Renewal is fully automated by
# the `certbot` service in docker-compose.yml (a `certbot renew` loop);
# this script handles the one genuinely one-time, credential-requiring
# step: the FIRST certificate for a domain, which needs an email address
# and explicit ToS agreement, and needs nginx switched from its
# no-certs-yet bootstrap config into the real HTTPS config around it.
#
# Usage: deploy/scripts/ssl-init.sh <domain> <email>
# Safe to re-run — a domain that already has a valid certificate is left
# untouched (checked via `certbot certificates`), not re-issued (Let's
# Encrypt rate-limits repeated issuance for the same domain).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NGINX_CONF_D="$DEPLOY_DIR/nginx/conf.d"
ACTIVE_CONF="$NGINX_CONF_D/kvl.conf"

DOMAIN="${1:-}"
EMAIL="${2:-}"

log() { echo "[ssl-init] $*"; }
fail() { echo "[ssl-init] ERROR: $*" >&2; exit 1; }

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  fail "Usage: $0 <domain> <email>"
fi

cd "$DEPLOY_DIR"

install_http_only_config() {
  log "Installing HTTP-only nginx config for $DOMAIN (ACME challenge path servable, no HTTPS yet)..."
  sed "s/\${DOMAIN_OR_UNDERSCORE}/$DOMAIN/g" "$NGINX_CONF_D/http-only.conf.template" > "$ACTIVE_CONF"
  docker compose exec -T nginx nginx -s reload 2>/dev/null || docker compose restart nginx
}

install_https_config() {
  log "Installing HTTPS nginx config for $DOMAIN..."
  sed "s/\${DOMAIN}/$DOMAIN/g" "$NGINX_CONF_D/https.conf.template" > "$ACTIVE_CONF"
  docker compose exec -T nginx nginx -t
  docker compose exec -T nginx nginx -s reload
}

already_has_cert() {
  docker compose run --rm --entrypoint sh certbot -c \
    "[ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]" >/dev/null 2>&1
}

if already_has_cert; then
  log "A certificate for $DOMAIN already exists — switching nginx to HTTPS mode without re-issuing."
  install_https_config
  log "Done."
  exit 0
fi

install_http_only_config

log "Requesting a certificate from Let's Encrypt for $DOMAIN (webroot HTTP-01 challenge)..."
if ! docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos \
  --non-interactive \
  --no-eff-email; then
  fail "Certificate issuance failed — nginx remains on HTTP-only. Check that $DOMAIN's DNS A record points at this server and port 80 is reachable from the internet, then re-run this script."
fi

log "Certificate obtained. Switching nginx to HTTPS."
install_https_config

log "SSL setup complete for $DOMAIN. Renewal is handled automatically by the 'certbot' service (checks twice daily) and the nginx container's own periodic reload — no further action needed."
