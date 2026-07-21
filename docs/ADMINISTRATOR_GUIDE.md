# Administrator Guide

Day-2 operations for a running KVL Super AI Chatbot instance. See
[docs/DEPLOYMENT.md](DEPLOYMENT.md) for the underlying architecture of
everything referenced here.

## Common commands (Docker deployment)

```bash
cd deploy

docker compose ps                          # status of every service
docker compose logs -f backend             # tail backend logs live
docker compose restart backend             # restart just the backend
docker compose exec backend sh             # shell into the backend container

../deploy/scripts/backup.sh                # manual backup
../deploy/scripts/update.sh                # safe update
../deploy/scripts/restore.sh --list        # list restorable backups
```

## Managing notification/monitoring settings

Website-change notifications (Phase 10) and their Email/Webhook channels
are configured via `PUT /api/monitor/notification-settings` — see
[docs/API.md](API.md) and [docs/AUTO_UPDATE_ENGINE.md](AUTO_UPDATE_ENGINE.md).
Infra-level monitoring (CPU/memory/Prometheus) is separate — see below.

## Enabling the optional Prometheus + Grafana stack

```bash
# One-time: set a real admin password
echo "GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 24)" >> .env

cd deploy
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml \
  --env-file ../.env up -d
```

Grafana listens on `127.0.0.1:3000` only (not exposed to the internet by
default) — reach it via an SSH tunnel (`ssh -L 3000:localhost:3000 you@server`)
or put it behind the main nginx yourself. Prometheus is pre-provisioned as
its datasource; import Grafana's official Node.js Application dashboard
(ID `11159`) for a ready-made view of what `/metrics` exports, or build
your own from the `kvl_http_*`/`kvl_process_*`/`kvl_nodejs_*` series.

## Managing plugins

```bash
# List what's registered
curl -H "x-api-key: $API_SECRET" http://localhost/api/deployment/plugins

# See what's on disk but not yet installed
curl -H "x-api-key: $API_SECRET" http://localhost/api/deployment/plugins/discover

# Install (drop a validated plugin.json + code into plugins/<name>/ first)
curl -X POST -H "x-api-key: $API_SECRET" -H "Content-Type: application/json" \
  -d '{"pluginDirName": "my-plugin"}' \
  http://localhost/api/deployment/plugins/install

# Enable / disable
curl -X POST -H "x-api-key: $API_SECRET" http://localhost/api/deployment/plugins/<id>/enable
curl -X POST -H "x-api-key: $API_SECRET" http://localhost/api/deployment/plugins/<id>/disable
```

Every plugin installs **disabled** by default (least-privilege). See
[docs/DEPLOYMENT.md](DEPLOYMENT.md#plugin-management) for the honest scope
boundary — this manages plugin lifecycle/permissions declarations; it does
not execute plugin code.

## Activating a license

```bash
# On this machine, get your fingerprint to send to your vendor:
docker compose exec backend node dist/deployment/cli/printMachineFingerprint.js

# Once you receive the signed license file back:
curl -X POST -H "x-api-key: $API_SECRET" -H "Content-Type: application/json" \
  -d "{\"licenseFileContent\": $(cat license.json | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}" \
  http://localhost/api/deployment/license/activate
```

Check status any time: `GET /api/deployment/license`.

## Firewall

```bash
sudo deploy/scripts/configure-firewall.sh --ssh-port 22   # match your real SSH port!
```

Not run automatically by `install.sh` — review the rules it stages before
confirming (it prompts before enabling).

## Rotating secrets

There is no single "rotate everything" command — secrets in `.env` are
independent. To rotate one (e.g. `API_SECRET`):

```bash
sed -i "s/^API_SECRET=.*/API_SECRET=$(openssl rand -base64 48 | tr -d '=+/\n' | head -c 64)/" .env
cd deploy && docker compose restart backend
```

Rotating `JWT_SECRET`/`SESSION_SECRET`/`COOKIE_SECRET` invalidates every
active session — expected, not a bug. Rotating `DB_PASSWORD` also requires
updating the running Postgres role's password
(`docker compose exec postgres psql -U postgres -c "ALTER ROLE ... PASSWORD '...'"`)
before restarting the backend, since Postgres doesn't re-read `.env`.

## Log locations

- Docker: `docker compose logs <service>` (all services log to stdout,
  12-factor style) — the backend additionally writes structured JSON to
  `logs/installer.log` inside its `backend_logs` volume.
- Bare-metal/systemd: `journalctl -u kvl-backend -f`, plus the same
  `logs/installer.log` file.

## Uninstalling

```bash
cd deploy
docker compose down            # stop and remove containers, keep volumes (data)
docker compose down -v         # ALSO delete every named volume — irreversible, deletes all data
```

Take a backup first if there's any chance you'll want the data back:
`../deploy/scripts/backup.sh final-backup`.
