#!/usr/bin/env bash
# Backend container entrypoint. Applies any pending Prisma migrations
# before starting the server — safe to run on every container start
# (prisma migrate deploy is idempotent: a fully-migrated database is a
# no-op) and is what makes "docker compose up" alone enough to get a
# schema-up-to-date server, with no separate manual migration step for
# either a first install or a later image upgrade.
#
# Waits for Postgres to actually accept connections first — the `postgres`
# service's own container can report "started" before it's ready to
# accept queries, and `prisma migrate deploy` fails hard (not gracefully)
# against a connection that's refused rather than merely slow.
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"

wait_for_postgres() {
  local attempt=0
  local max_attempts=30
  until node -e "
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.connect().then(() => client.end()).then(() => process.exit(0)).catch(() => process.exit(1));
  " >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "backend-entrypoint: postgres did not become reachable after ${max_attempts} attempts — giving up" >&2
      exit 1
    fi
    echo "backend-entrypoint: waiting for postgres (attempt ${attempt}/${max_attempts})..."
    sleep 2
  done
}

if [ "${SKIP_DB_WAIT:-false}" != "true" ]; then
  wait_for_postgres
fi

if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "backend-entrypoint: applying Prisma migrations..."
  npx prisma migrate deploy --schema=./prisma/schema.prisma
fi

echo "backend-entrypoint: starting server..."
exec node dist/index.js
