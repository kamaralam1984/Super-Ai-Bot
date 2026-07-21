# KVL Super AI Chatbot — frontend production image: builds the React/Vite
# SPA and serves the resulting static bundle via Nginx. This is a static
# file server only — it holds no application secrets and makes no direct
# database/Redis connections. The top-level reverse proxy (deploy/nginx/)
# sits in front of both this container and the backend container and is
# what a browser actually talks to; this container never needs to be
# reachable directly from outside the Docker network.
#
# Build context MUST be the monorepo root:
#   docker build -f deploy/docker/frontend.Dockerfile -t kvl-frontend .

########################################
# Stage 1: build
########################################
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# `npm ci` at the workspace root installs every workspace's dependencies
# from the single shared lockfile — including backend's, even though this
# image only ever builds frontend+shared. backend's hnswlib-node is a
# native addon (node-gyp/Python compiled at install time), so without
# these build tools present here too (backend.Dockerfile already has them
# for its own build) `npm ci` fails on this image specifically, despite
# the compiled addon never actually being used by anything this image
# ships.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY shared/package.json ./shared/package.json
COPY frontend/package.json ./frontend/package.json

RUN npm ci

COPY shared ./shared
COPY frontend ./frontend

RUN npm run build --workspace=shared \
    && npm run build --workspace=frontend

########################################
# Stage 2: serve
########################################
FROM nginx:1.27-alpine AS runtime

RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/docker/frontend.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

RUN addgroup -g 10001 kvl 2>/dev/null || true \
    && adduser -D -u 10001 -G kvl kvl 2>/dev/null || true \
    && touch /var/run/nginx.pid \
    && chown -R kvl:kvl /usr/share/nginx/html /var/cache/nginx /var/run/nginx.pid /etc/nginx/conf.d

USER kvl

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
