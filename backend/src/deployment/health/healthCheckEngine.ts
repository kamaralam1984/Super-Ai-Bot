// Health Check Engine — post-deployment verification of every layer the
// spec calls out (Frontend, Backend, AI Engine, Scanner, Knowledge Base,
// Connectors, Database, Redis, Vector Database, Storage, SSL, Internet).
// Deliberately distinct from services/systemCheck.service.ts (Phase 1's
// PRE-install probe of the bare host, checking `127.0.0.1` for services
// that don't exist yet) — this checks the ACTUAL configured runtime
// connections (DATABASE_URL/REDIS_URL, wherever they really point:
// `postgres`/`redis` Docker service names in a container deployment,
// `localhost` in a bare-metal one) after the platform is already up.
// Reuses systemCheck.service.ts's genuinely host-agnostic primitives
// (checkInternetConnectivity, getDiskSpace) rather than re-implementing
// them; everything else here is new because it targets configured
// connections, not host probing.

import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { checkInternetConnectivity } from "../../utils/network";
import { getDiskSpace } from "../../utils/diskSpace";
import { inspectTlsCertificate } from "../../utils/ssl";
import { getDefaultVectorStore } from "../../knowledge/vector/vectorStore";
import { getActiveInstallationId } from "../../scanner/scanRecord.service";
import { APP_ROOT } from "../../config/paths";
import { formatError } from "../../utils/formatError";

export type HealthStatus = "pass" | "warn" | "fail";

export interface HealthCheckItem {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
  durationMs: number;
}

export interface HealthReport {
  status: HealthStatus;
  checkedAt: string;
  items: HealthCheckItem[];
}

async function timed(id: string, label: string, fn: () => Promise<Omit<HealthCheckItem, "id" | "label" | "durationMs">>): Promise<HealthCheckItem> {
  const start = Date.now();
  try {
    const result = await fn();
    return { id, label, durationMs: Date.now() - start, ...result };
  } catch (err) {
    return { id, label, status: "fail", detail: formatError(err), durationMs: Date.now() - start };
  }
}

async function checkBackend(): Promise<HealthCheckItem> {
  return timed("backend", "Backend", async () => ({ status: "pass", detail: `Process healthy (uptime ${Math.round(process.uptime())}s)` }));
}

// In a Docker deployment, `frontend` is the nginx-served static build
// (frontend.nginx.conf's own /healthz route). In development, there is no
// such container — the Vite dev server itself (vite.config.ts's
// `server.port`) is "the frontend," reachable at its plain root (Vite
// doesn't define a /healthz route of its own, so root is the honest
// check here) rather than a Docker-only hostname that was never going to
// resolve outside a container network.
function defaultFrontendHealthUrl(): string {
  return process.env.NODE_ENV === "production" ? "http://frontend:8080/healthz" : "http://localhost:3041/";
}

async function checkFrontend(): Promise<HealthCheckItem> {
  return timed("frontend", "Frontend", async () => {
    const url = process.env.FRONTEND_HEALTH_URL || defaultFrontendHealthUrl();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok ? { status: "pass", detail: `Reachable at ${url}` } : { status: "fail", detail: `${url} responded HTTP ${res.status}` };
    } catch (err) {
      const context = process.env.NODE_ENV === "production" ? "" : " — is `npm run dev:frontend` running?";
      return { status: "warn", detail: `Could not reach ${url} (${formatError(err)})${context}` };
    }
  });
}

async function checkDatabase(databaseUrl: string): Promise<HealthCheckItem> {
  return timed("database", "Database (PostgreSQL)", async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "pass", detail: "Reachable and accepting queries" };
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function checkRedis(redisUrl: string): Promise<HealthCheckItem> {
  return timed("redis", "Redis", async () => {
    const client = new Redis(redisUrl, { connectTimeout: 4000, maxRetriesPerRequest: 1, lazyConnect: true });
    try {
      await client.connect();
      const pong = await client.ping();
      return pong === "PONG" ? { status: "pass", detail: "Reachable and responding to PING" } : { status: "fail", detail: `Unexpected PING response: ${pong}` };
    } finally {
      client.disconnect();
    }
  });
}

async function checkVectorIndex(installationId: string | null): Promise<HealthCheckItem> {
  return timed("vector_index", "Vector Database (embedded HNSW index)", async () => {
    if (!installationId) return { status: "warn", detail: "No completed installation yet — nothing to index" };
    const stats = getDefaultVectorStore().stats(installationId);
    if (!stats) return { status: "warn", detail: "No vector index built yet for this installation (run a knowledge build first)" };
    return { status: "pass", detail: `${stats.vectorCount} vectors, ${stats.dimensions} dimensions` };
  });
}

async function checkStorage(): Promise<HealthCheckItem> {
  return timed("storage", "Storage", async () => {
    const disk = await getDiskSpace(APP_ROOT);
    const freeGb = disk.availableKb / 1024 ** 2;
    if (freeGb < 1) return { status: "fail", detail: `Only ${freeGb.toFixed(2)}GB free — critically low` };
    if (freeGb < 5) return { status: "warn", detail: `${freeGb.toFixed(1)}GB free — getting low` };
    return { status: "pass", detail: `${freeGb.toFixed(1)}GB free` };
  });
}

async function checkSsl(): Promise<HealthCheckItem> {
  return timed("ssl", "SSL/TLS", async () => {
    const domain = process.env.DOMAIN;
    if (!domain) return { status: "warn", detail: "No DOMAIN configured — running over HTTP only (see docs/DEPLOYMENT.md's SSL Manager section)" };
    const info = await inspectTlsCertificate(domain, 443);
    if (!info.found || !info.expiresAt) return { status: "fail", detail: `Could not verify a live certificate for ${domain}` };
    const daysLeft = Math.floor((new Date(info.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    if (daysLeft < 7) return { status: "fail", detail: `Certificate for ${domain} expires in ${daysLeft} day(s) — renewal appears to be failing` };
    if (daysLeft < 21) return { status: "warn", detail: `Certificate for ${domain} expires in ${daysLeft} day(s)` };
    return { status: "pass", detail: `Certificate for ${domain} valid, expires in ${daysLeft} day(s)` };
  });
}

async function checkInternet(): Promise<HealthCheckItem> {
  return timed("internet", "Internet Connectivity", async () => {
    const result = await checkInternetConnectivity();
    return { status: result.online ? "pass" : "fail", detail: result.detail };
  });
}

async function checkAiEngine(): Promise<HealthCheckItem> {
  return timed("ai_engine", "AI Engine (LLM configuration)", async () => {
    const provider = process.env.LLM_PROVIDER;
    if (!provider) return { status: "warn", detail: "LLM_PROVIDER not set — the chat engine (Phase 8) will refuse to start until configured" };
    if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
      return { status: "fail", detail: "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set" };
    }
    if (provider === "openai_compatible" && !process.env.LLM_BASE_URL) {
      return { status: "fail", detail: "LLM_PROVIDER=openai_compatible but LLM_BASE_URL is not set" };
    }
    return { status: "pass", detail: `Configured: ${provider}` };
  });
}

// Mirrors scanner/parse/headlessRenderer.ts's own fallback exactly — that
// module already falls back to this same default when
// PLAYWRIGHT_CHROMIUM_PATH is unset, so a health check that only looked
// at the env var (and not this fallback) would warn even when the
// scanner is genuinely fine, which it was doing until this fix.
const FALLBACK_CHROMIUM_PATH = "/usr/bin/google-chrome-stable";

async function checkScanner(): Promise<HealthCheckItem> {
  return timed("scanner", "Website Scanner", async () => {
    const configuredPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
    if (configuredPath) {
      return fs.existsSync(configuredPath)
        ? { status: "pass", detail: `Headless renderer configured: ${configuredPath}` }
        : { status: "fail", detail: `PLAYWRIGHT_CHROMIUM_PATH is set to ${configuredPath}, but no file exists there` };
    }
    if (fs.existsSync(FALLBACK_CHROMIUM_PATH)) {
      return { status: "pass", detail: `Using fallback headless renderer at ${FALLBACK_CHROMIUM_PATH} — set PLAYWRIGHT_CHROMIUM_PATH explicitly to pin this` };
    }
    return { status: "warn", detail: "No Chromium/Chrome binary found (checked PLAYWRIGHT_CHROMIUM_PATH and the default fallback) — JavaScript-rendered pages will fail to scan (see scanner/parse/headlessRenderer.ts)" };
  });
}

async function checkKnowledgeBase(databaseUrl: string, installationId: string | null): Promise<HealthCheckItem> {
  return timed("knowledge_base", "Knowledge Base", async () => {
    if (!installationId) return { status: "warn", detail: "No completed installation yet" };
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const count = await prisma.knowledgeChunk.count({ where: { crawlJob: { installationId }, isDuplicate: false } });
      return count > 0 ? { status: "pass", detail: `${count} knowledge chunks live` } : { status: "warn", detail: "No knowledge chunks built yet" };
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function checkConnectors(databaseUrl: string, installationId: string | null): Promise<HealthCheckItem> {
  return timed("connectors", "Connectors", async () => {
    if (!installationId) return { status: "warn", detail: "No completed installation yet" };
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const grouped = await prisma.connector.groupBy({ by: ["status"], where: { installationId }, _count: true });
      if (grouped.length === 0) return { status: "warn", detail: "No connectors configured" };
      const summary = grouped.map((g) => `${g.status}=${g._count}`).join(", ");
      const anyError = grouped.some((g) => g.status === "ERROR" || g.status === "DISCONNECTED");
      return { status: anyError ? "warn" : "pass", detail: summary };
    } finally {
      await prisma.$disconnect();
    }
  });
}

/** Runs every check concurrently and rolls them up into one overall status: `fail` if any required check failed, `warn` if any warned, `pass` otherwise. */
export async function runHealthChecks(): Promise<HealthReport> {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const installationId = databaseUrl ? await getActiveInstallationId(databaseUrl).catch(() => null) : null;

  const checks: Promise<HealthCheckItem>[] = [checkBackend(), checkFrontend(), checkStorage(), checkSsl(), checkInternet(), checkAiEngine(), checkScanner()];

  if (databaseUrl) {
    checks.push(checkDatabase(databaseUrl), checkVectorIndex(installationId), checkKnowledgeBase(databaseUrl, installationId), checkConnectors(databaseUrl, installationId));
  } else {
    checks.push(Promise.resolve({ id: "database", label: "Database (PostgreSQL)", status: "fail" as const, detail: "DATABASE_URL not configured", durationMs: 0 }));
  }

  if (redisUrl) {
    checks.push(checkRedis(redisUrl));
  } else {
    checks.push(Promise.resolve({ id: "redis", label: "Redis", status: "warn" as const, detail: "REDIS_URL not configured", durationMs: 0 }));
  }

  const items = await Promise.all(checks);
  const status: HealthStatus = items.some((i) => i.status === "fail") ? "fail" : items.some((i) => i.status === "warn") ? "warn" : "pass";

  return { status, checkedAt: new Date().toISOString(), items };
}
