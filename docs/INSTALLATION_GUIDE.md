# Installation Guide

Two supported paths — pick one. See [docs/DEPLOYMENT.md](DEPLOYMENT.md)
for the full architecture behind either.

## Path A — Docker (recommended, fully automated)

**Requirements**: Ubuntu 22.04+/24.04+ or Debian, 2 vCPU / 4GB RAM minimum
(4 vCPU / 8GB recommended), 10GB free disk minimum (20GB+ recommended once
a real knowledge base and backups accumulate), a domain name pointed at
this server (optional — HTTPS requires it, an IP-only install works over
HTTP).

```bash
git clone <your KVL repository URL> kvl-super-ai-chatbot
cd kvl-super-ai-chatbot
sudo ./deploy/scripts/install.sh \
  --domain chat.example.com \
  --email admin@example.com \
  --website-name "Acme Corp" \
  --website-url "https://acme.example.com"
```

Omit `--domain`/`--email` (or pass `--skip-ssl`) for an HTTP-only install —
you can add a domain and run `deploy/scripts/ssl-init.sh <domain> <email>`
later.

The script: checks system requirements → installs Docker/Compose if
missing → creates a system user + runtime directories → generates `.env`
(all secrets, real CSPRNG) → builds and starts every container → requests
a TLS certificate (if `--domain` given) → verifies `/health` → prints the
final URL. Takes several minutes on first run (building images, downloading
the local embedding model on first use).

**What you get at the end**: a fully configured platform reachable at the
printed URL — no further browser setup wizard needed (install.sh already
did the equivalent of Phase 1's wizard, Docker-appropriately — see
DEPLOYMENT.md for why).

### Verify it worked

```bash
curl http://localhost/health
curl -H "x-api-key: $(grep API_SECRET .env | cut -d= -f2)" http://localhost/api/deployment/health
```

The second command should return `"status":"pass"` for `backend`,
`database`, `redis`, `storage`, `internet` at minimum (`ai_engine` will
warn until you set `ANTHROPIC_API_KEY`/`LLM_BASE_URL` — see below).

### Next steps

- Configure the AI chat engine: edit `.env`'s `LLM_PROVIDER`/
  `ANTHROPIC_API_KEY` (or `LLM_BASE_URL` for a self-hosted model), then
  `cd deploy && docker compose up -d backend` to apply.
- Trigger the first website scan + AI training via the existing REST API
  (`POST /api/scan/start`, then `POST /api/training/start`) — see
  [docs/API.md](API.md).
- Review [docs/ADMINISTRATOR_GUIDE.md](ADMINISTRATOR_GUIDE.md) for
  day-2 operations (backups, updates, monitoring).

## Path B — Bare-metal / native (no Docker)

More manual — see [docs/DEPLOYMENT.md](DEPLOYMENT.md#bare-metal--manual-deployment-no-docker)
for the full command sequence (build, systemd unit, Nginx config
adaptation). Use this path if your environment can't run Docker, or you
have organizational reasons to run Node/Postgres/Redis/Nginx natively.

## Requirements checklist

| Requirement | Docker path | Bare-metal path |
|---|---|---|
| OS | Ubuntu 22.04+/24.04+/Debian | same |
| RAM | 4GB+ (2GB hard minimum) | same |
| Disk | 10GB+ free | same |
| Docker + Compose | Installed automatically | Not needed |
| PostgreSQL 16 | Runs in a container | Install natively |
| Redis 7 | Runs in a container | Install natively |
| Nginx | Runs in a container | Install natively |
| Node.js 20+ | Only inside containers | Install natively |
| Domain name | Optional (for HTTPS) | Optional (for HTTPS) |

## Troubleshooting a failed install

See [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md). `install.sh` logs every
step to `logs/install-<timestamp>.log` and rolls the Docker stack back
(`docker compose down`) on failure without deleting the generated `.env`
or directories — fix the underlying issue and re-run the same command;
it's safe to re-run (an existing `.env` is never overwritten).
