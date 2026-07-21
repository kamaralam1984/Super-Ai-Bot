# Upgrade Guide

See [docs/DEPLOYMENT.md](DEPLOYMENT.md#automatic-updates) for how Update
Manager works internally (pre-update backup, image tagging, automatic
rollback on a failed health check).

## Docker deployments

```bash
cd kvl-super-ai-chatbot
sudo ./deploy/scripts/update.sh
```

Add `--branch <name>` to track a branch other than `main`, `--yes` to skip
the confirmation prompt (useful in a cron/CI context), `--force` to
proceed even with uncommitted local changes in the working tree
(**overwrites them** — only use this if you're certain nothing local is
worth keeping).

What happens, in order:
1. `git fetch` + compares your current commit against the remote branch —
   exits immediately (no-op) if you're already up to date.
2. Takes a full backup (`deploy/scripts/backup.sh pre-update-<commit>`) —
   this is the real safety net; if anything below goes wrong, this backup
   is what you'd restore from even if the automatic rollback (next steps)
   somehow can't run.
3. Tags the currently-running images `kvl-backend:rollback` /
   `kvl-frontend:rollback`.
4. Pulls the new code and rebuilds images.
5. Restarts — Postgres migrations apply automatically inside the backend
   container's entrypoint, no separate migration step needed.
6. Polls `/health` for up to 2.5 minutes.
7. **If the health check never passes**: automatically resets the code to
   the pre-update commit and restarts using the `:rollback`-tagged images
   — you end up back where you started, not on a broken half-updated
   version.

### Manually rolling back after a successful-but-unwanted update

```bash
git log --oneline -5              # find the commit you want to go back to
git reset --hard <commit>
cd deploy && IMAGE_TAG=rollback docker compose --env-file ../.env up -d --no-build
```

(`:rollback` only ever holds the *immediately previous* version's images —
for anything older, restore from a backup taken before that update instead:
`deploy/scripts/restore.sh --list`.)

## Bare-metal deployments

```bash
git pull
npm install --omit=dev && npm run build
cd backend && npx prisma migrate deploy && cd ..
sudo systemctl restart kvl-backend
curl http://localhost:4500/health
```

There is no automatic rollback for the bare-metal path — take a manual
backup first (`docs/BACKUP_GUIDE.md`) if you want one.

## Checking your current version

```bash
curl -H "x-api-key: $API_SECRET" http://localhost/api/deployment/version
```

Returns `{ version, nodeVersion, nodeEnv, startedAt }` — `version` is
`backend/package.json`'s own version field.
