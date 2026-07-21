# KVL Super AI Chatbot — backend production image.
#
# This single image is the ENTIRE application server: REST/WebSocket API,
# AI engine (embeddings/RAG/chat), website scanner, connector engine, and
# every background job (retrain scheduler, cron runtime, job queue) all
# run in-process inside this one container — a deliberate, repeatedly
# documented architectural choice throughout this codebase (see
# retrain/retrainScheduler.ts, monitor/jobs/jobQueue.ts's own doc
# comments), not a placeholder for microservices that don't exist. There
# is intentionally no separate "ai-engine" / "scanner" / "worker"
# container — that would require a real architectural rewrite this phase
# is not scoped to make. See deploy/../docs/DEPLOYMENT.md.
#
# Build context MUST be the monorepo root (the `..` two levels up from
# this file), since this is an npm workspaces project:
#   docker build -f deploy/docker/backend.Dockerfile -t kvl-backend .

########################################
# Stage 1: install + build (dev deps included)
########################################
FROM node:20-bookworm-slim AS builder

# python3/make/g++ are required to compile this project's two native
# addons (argon2, hnswlib-node) via node-gyp during `npm ci`.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only manifests first so `npm ci` is Docker-layer-cached across
# builds that don't change dependencies.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY shared/package.json ./shared/package.json
COPY frontend/package.json ./frontend/package.json

RUN npm ci

COPY shared ./shared
COPY backend ./backend

RUN npm run build --workspace=shared \
    && npx prisma generate --schema=backend/prisma/schema.prisma \
    && npm run build --workspace=backend

########################################
# Stage 2: production-only dependencies
########################################
FROM node:20-bookworm-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY shared/package.json ./shared/package.json
COPY frontend/package.json ./frontend/package.json

# npm ci resolves the lockfile against every workspace declared in the
# root package.json, so frontend's manifest must be present even though
# this stage never installs/builds it (it's excluded from what actually
# gets installed via --workspace, kept for lockfile resolution only).
# --omit=dev still needs the native-addon build toolchain (installed
# above) because argon2/hnswlib-node compile from source on `npm ci`;
# the toolchain itself is not copied into the final runtime stage.
RUN npm ci --omit=dev --workspace=backend --workspace=shared \
    && npx prisma generate --schema=backend/prisma/schema.prisma

########################################
# Stage 3: runtime
########################################
FROM node:20-bookworm-slim AS runtime

# - openssl/ca-certificates: Prisma's query engine binary and every HTTPS
#   call this app makes (safeFetch, connector clients, SMTP, webhooks)
#   need these; Debian's "slim" base omits them by default.
# - chromium + fonts/libs: the scanner's headless-render fallback
#   (scanner/parse/headlessRenderer.ts) needs a real browser for
#   JavaScript-rendered pages. Installed from Debian's own package
#   (not `playwright install`'s downloader) so it's baked into the image
#   layer — no runtime internet dependency, no separate persistent-volume
#   requirement for browser binaries, and it gets security updates via
#   normal `apt upgrade` on image rebuild.
# - postgresql-client-16/redis-tools: the Backup Manager
#   (deployment/backup/backupService.ts) shells out to `pg_dump` and
#   `redis-cli --rdb` directly — genuinely simpler and more robust than
#   reimplementing either dump format, and avoids needing a *separate*
#   backup container with its own cross-container volume access (this
#   container already owns every directory it needs to archive). Pinned
#   to major version 16 via PGDG's own apt repo, matching
#   docker-compose.yml's `postgres:16-alpine` exactly — `pg_dump` is not
#   reliably forward-compatible with a *newer* server than itself, and
#   Debian bookworm's own default (unversioned) postgresql-client package
#   is not guaranteed to match whatever Postgres major version this
#   stack's compose file pins.
# - tini: a real, minimal init process — Node as PID 1 does not reap
#   zombie processes or forward signals correctly (SIGTERM from
#   `docker stop` needs to actually reach Node for graceful shutdown).
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates tini curl gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends \
      postgresql-client-16 redis-tools \
      chromium fonts-liberation fonts-noto-color-emoji \
      libnss3 libatk-bridge2.0-0 libatk1.0-0 libgtk-3-0 libgbm1 \
      libasound2 libxss1 libxshmfence1 libxrandr2 libxdamage1 libxcomposite1 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium

RUN groupadd --gid 10001 kvl \
    && useradd --uid 10001 --gid kvl --shell /usr/sbin/nologin --create-home kvl

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY package.json ./package.json

# Every RUNTIME_DIRECTORIES entry (backend/src/config/paths.ts) as a
# mount point — actual persistence is provided by the volumes declared in
# deploy/docker-compose.yml, this just ensures the paths exist with
# correct ownership even before a volume is attached (e.g. `docker run`
# without compose).
RUN mkdir -p logs storage cache uploads models embeddings knowledge config backups plugins connectors temp \
    && chown -R kvl:kvl /app

COPY deploy/docker/backend-entrypoint.sh /usr/local/bin/backend-entrypoint.sh
RUN chmod +x /usr/local/bin/backend-entrypoint.sh

USER kvl

WORKDIR /app/backend

EXPOSE 4000 4500

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4500/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/backend-entrypoint.sh"]
