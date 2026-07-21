// Monitoring — Prometheus-format metrics via prom-client. Deliberately
// NOT proxied by the public nginx edge (see deploy/nginx/conf.d/
// kvl-locations.conf — no /metrics location exists there) — a Prometheus
// scraper reaches this container directly over the internal Docker
// network (`backend:4500/metrics`), the same "not everything reachable
// from inside the network needs to be internet-reachable" boundary the
// rest of this deployment already draws (postgres/redis have no exposed
// host ports either). See deploy/monitoring/ for an optional
// Prometheus+Grafana overlay that scrapes this.

import client from "prom-client";
import type { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { getDiskSpace } from "../../utils/diskSpace";
import { APP_ROOT } from "../../config/paths";
import { getActiveInstallationId } from "../../scanner/scanRecord.service";

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: "kvl_" });

// Node-process metrics (CPU/memory/event-loop-lag/GC, above) plus
// HTTP request metrics (below) cover "API" from the spec's Monitoring
// list directly. These four gauges close the rest of it with real,
// on-demand values computed fresh on every scrape (not cached) —
// disk/DB/Redis/background-job-queue-depth. Deliberately NOT covered
// here: per-Docker-container CPU/memory and host network throughput —
// this process can only introspect itself, not sibling containers or the
// host's network interfaces, without Docker-socket/host-network access
// this deployment's zero-trust posture doesn't grant any container (see
// docker-compose.yml's nginx service comment for the same reasoning
// applied elsewhere). A real container-level view needs cAdvisor or
// node_exporter as an additional scrape target — not wired up here,
// stated honestly rather than faked with a metric that always reads 0.
new client.Gauge({
  name: "kvl_disk_free_bytes",
  help: "Free disk space at the application root",
  registers: [registry],
  async collect() {
    try {
      const disk = await getDiskSpace(APP_ROOT);
      this.set(disk.availableKb * 1024);
    } catch {
      // df itself failing is a real signal, but not one this gauge can
      // usefully represent as a number — leaving it unset (absent from
      // the scrape) is more honest than reporting a fabricated 0.
    }
  },
});

new client.Gauge({
  name: "kvl_database_up",
  help: "1 if PostgreSQL is reachable, 0 otherwise",
  registers: [registry],
  async collect() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      this.set(0);
      return;
    }
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await prisma.$queryRaw`SELECT 1`;
      this.set(1);
    } catch {
      this.set(0);
    } finally {
      await prisma.$disconnect();
    }
  },
});

new client.Gauge({
  name: "kvl_redis_up",
  help: "1 if Redis is reachable, 0 otherwise",
  registers: [registry],
  async collect() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.set(0);
      return;
    }
    const redis = new Redis(redisUrl, { connectTimeout: 3000, maxRetriesPerRequest: 1, lazyConnect: true });
    try {
      await redis.connect();
      const pong = await redis.ping();
      this.set(pong === "PONG" ? 1 : 0);
    } catch {
      this.set(0);
    } finally {
      redis.disconnect();
    }
  },
});

new client.Gauge({
  name: "kvl_background_jobs_queued",
  help: "Background jobs currently PENDING or RUNNING (Phase 10's BackgroundJob table)",
  labelNames: ["status"],
  registers: [registry],
  async collect() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return;
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const installationId = await getActiveInstallationId(databaseUrl);
      if (!installationId) return;
      const grouped = await prisma.backgroundJob.groupBy({ by: ["status"], where: { installationId, status: { in: ["PENDING", "RUNNING"] } }, _count: true });
      for (const group of grouped) this.set({ status: group.status }, group._count);
    } catch {
      // absent from the scrape rather than a fabricated 0 — same
      // reasoning as the disk gauge above.
    } finally {
      await prisma.$disconnect();
    }
  },
});

const httpRequestsTotal = new client.Counter({
  name: "kvl_http_requests_total",
  help: "Total HTTP requests handled",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});

const httpRequestDuration = new client.Histogram({
  name: "kvl_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/** Route pattern (e.g. "/api/knowledge/:id"), not the raw URL — an unbounded label cardinality (one series per distinct visited URL) is exactly the mistake that makes a metrics endpoint useless/dangerous at scale. Falls back to the raw path only when Express hasn't matched a route yet (e.g. a 404). */
function routeLabel(req: Request): string {
  return req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const stop = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const labels = { method: req.method, route: routeLabel(req), status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    stop(labels);
  });
  next();
}

export async function getMetrics(): Promise<{ contentType: string; body: string }> {
  return { contentType: registry.contentType, body: await registry.metrics() };
}
