#!/usr/bin/env bash
# Security — configures ufw (Uncomplicated Firewall) with a
# default-deny-inbound posture: only SSH, HTTP, and HTTPS reach the host
# directly (Postgres/Redis/the backend's own port are never exposed to
# the host in the Docker deployment anyway — see docker-compose.yml — so
# this closes the same doors at the OS level too, defense in depth for a
# bare-metal/native deployment where they otherwise would be).
#
# NOT run automatically by install.sh — enabling a firewall wrong (e.g.
# on a non-standard SSH port this script doesn't know about) can lock an
# operator out of their own server, which this product will not risk
# doing without explicit, informed action. Run it yourself once you've
# confirmed your actual SSH port below.
#
# Usage: sudo deploy/scripts/configure-firewall.sh [--ssh-port 22]
set -euo pipefail

SSH_PORT="22"
while [ $# -gt 0 ]; do
  case "$1" in
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    -h|--help) echo "Usage: $0 [--ssh-port <port>]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must be run as root." >&2
  exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
  echo "Installing ufw..."
  apt-get update -y && apt-get install -y ufw
fi

echo "Configuring ufw: default deny incoming, allow SSH ($SSH_PORT/tcp), HTTP (80/tcp), HTTPS (443/tcp)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp" comment "SSH"
ufw allow 80/tcp comment "HTTP (redirects to HTTPS + ACME challenge)"
ufw allow 443/tcp comment "HTTPS"

echo "Current rules that will apply once enabled:"
ufw show added

read -r -p "Enable ufw with these rules now? [y/N] " CONFIRM
case "$CONFIRM" in
  y|Y|yes|YES)
    ufw --force enable
    echo "Firewall enabled. Status:"
    ufw status verbose
    ;;
  *)
    echo "Rules staged but NOT enabled — run 'ufw enable' yourself when ready, or 'ufw reset' to discard them."
    ;;
esac
