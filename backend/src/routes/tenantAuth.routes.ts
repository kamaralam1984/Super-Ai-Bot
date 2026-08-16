import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { z } from "zod";
import { TokenBucketRateLimiter } from "../knowledge/security/accessControl";
import { recordAuditEvent } from "../knowledge/security/auditLog";
import { generateId } from "../services/security.service";
import { runTenantOnboarding } from "../services/tenantOnboarding.service";
import {
  createTenantSessionToken,
  setTenantSessionCookie,
  clearTenantSessionCookie,
  verifyTenantSessionToken,
  TENANT_SESSION_COOKIE_NAME,
} from "../middleware/tenantSession";
import { getSocketServer } from "../ws/socket";
import { AppError } from "../middleware/errorHandler";
import { ALL_DATA_SCOPES } from "../permission/types";
import type { DataScope } from "@kvl/shared";

export const tenantAuthRouter = Router();

// Tighter than the general kvl_api zone (deploy/nginx/includes/
// kvl-locations.conf mirrors this at the edge for the whole /api/tenant/
// tree), matching adminAuth.routes.ts's LOGIN_RATE_LIMIT profile — signup
// and login are exactly what a credential-stuffing/spam-account attempt
// would target.
const SIGNUP_RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 5, refillPerSecond: 0.05 });
const LOGIN_RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 5, refillPerSecond: 0.1 });

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new AppError(400, "No database configured", "Complete the installer first.", true);
  return databaseUrl;
}

const signupSchema = z.object({
  businessName: z.string().min(2).max(100),
  websiteUrl: z.string().url(),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

/**
 * Creates the Account + Installation rows in the one already-provisioned
 * shared database — no .env write, no database provisioning, no secret
 * generation of the kind config.service.ts/database.service.ts do for the
 * platform installer. Auto-logs in (sets the session cookie) so the
 * frontend's signup wizard can move straight into the onboarding step
 * without a second round-trip.
 */
tenantAuthRouter.post("/signup", async (req, res, next) => {
  try {
    const clientId = req.ip ?? "unknown";
    if (!SIGNUP_RATE_LIMIT.tryConsume(clientId)) {
      recordAuditEvent({ type: "rate_limited", detail: `client=${clientId} path=/api/tenant/signup`, component: "tenant-auth" });
      throw new AppError(429, "Too many signup attempts", "Wait a few minutes and try again.", true);
    }

    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }
    const { businessName, websiteUrl, email, password } = parsed.data;

    const databaseUrl = requireDatabaseUrl();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const existing = await prisma.account.findUnique({ where: { email } });
      if (existing) throw new AppError(409, "An account with this email already exists", "Log in instead, or use a different email.", false);

      const passwordHash = await argon2.hash(password);
      const applicationId = generateId("app");
      const installationId = generateId("inst");

      const { account, installation } = await prisma.$transaction(async (tx) => {
        const account = await tx.account.create({
          data: { email, passwordHash, businessName, status: "PENDING_ONBOARDING" },
        });
        const installation = await tx.installation.create({
          data: { applicationId, installationId, websiteName: businessName, websiteUrl, status: "IN_PROGRESS", accountId: account.id },
        });
        return { account, installation };
      });

      // The session claim must be Installation.id (the internal cuid every
      // FK relation — CrawlJob, PermissionGrant, Conversation, etc. —
      // actually points at), NOT installation.installationId (the public
      // "inst_xxx" string, which is only ever meant for the widget embed
      // and the signup response below). Passing the public string here
      // was the bug: every route resolving installationId through
      // tenantContext.ts's resolveInstallationId would receive a value
      // that fails every foreign-key-constrained write.
      const token = await createTenantSessionToken(account.id, installation.id);
      setTenantSessionCookie(res, token);
      res.json({ success: true, data: { accountId: account.id, installationId: installation.installationId } });
    } finally {
      await prisma.$disconnect();
    }
  } catch (err) {
    next(err);
  }
});

const onboardingStartSchema = z.object({
  socketId: z.string().min(1),
  grantedScopes: z.array(z.enum(ALL_DATA_SCOPES as [string, ...string[]])).optional(),
});

/**
 * Kicks off the scan+training+permissions pipeline for the caller's own
 * installation — mirrors install.routes.ts's POST /start (progress is
 * streamed to the caller's own socket room, not this HTTP response), but
 * requires a tenant session and never accepts a client-supplied
 * installationId — it can only ever onboard the session's own tenant.
 */
tenantAuthRouter.post("/onboarding/start", async (req, res, next) => {
  try {
    // Checked directly here, not via req.tenantContext / the generic
    // injectTenantContext middleware — this route is under /api/tenant,
    // which app.ts mounts *before* that middleware runs (same reasoning
    // as adminAuth.routes.ts's /installation).
    const token = req.cookies?.[TENANT_SESSION_COOKIE_NAME];
    const context = token ? await verifyTenantSessionToken(token) : null;
    if (!context) throw new AppError(401, "Not authenticated", "Log in first.", false);

    const parsed = onboardingStartSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }

    const databaseUrl = requireDatabaseUrl();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let installationRowId: string;
    let websiteUrl: string;
    try {
      const installation = await prisma.installation.findUnique({ where: { accountId: context.accountId } });
      if (!installation) throw new AppError(404, "No installation found for this account", undefined, false);
      installationRowId = installation.id;
      websiteUrl = installation.websiteUrl;
    } finally {
      await prisma.$disconnect();
    }

    const io = getSocketServer();
    runTenantOnboarding(io, parsed.data.socketId, {
      accountId: context.accountId,
      installationRowId,
      websiteUrl,
      grantedScopes: parsed.data.grantedScopes as DataScope[] | undefined,
    }).catch((err) => {
      recordAuditEvent({ type: "access_denied", detail: `onboarding failed for account=${context.accountId}: ${err instanceof Error ? err.message : String(err)}`, component: "tenant-onboarding" });
    });
    res.json({ success: true, data: { started: true } });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

tenantAuthRouter.post("/login", async (req, res, next) => {
  try {
    const clientId = req.ip ?? "unknown";
    if (!LOGIN_RATE_LIMIT.tryConsume(clientId)) {
      recordAuditEvent({ type: "rate_limited", detail: `client=${clientId} path=/api/tenant/login`, component: "tenant-auth" });
      throw new AppError(429, "Too many login attempts", "Wait a few minutes and try again.", true);
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid request body", "Provide { email, password }.", true);

    const databaseUrl = requireDatabaseUrl();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const account = await prisma.account.findUnique({ where: { email: parsed.data.email }, include: { installation: true } });
      const valid = account ? await argon2.verify(account.passwordHash, parsed.data.password).catch(() => false) : false;
      if (!account || !valid) {
        recordAuditEvent({ type: "access_denied", detail: `client=${clientId} path=/api/tenant/login`, component: "tenant-auth" });
        throw new AppError(401, "Invalid email or password", undefined, false);
      }
      if (!account.installation) throw new AppError(500, "Account has no installation", "Contact support.", false);

      await prisma.account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });

      // Same reasoning as /signup above — Installation.id, not the public installationId string.
      const token = await createTenantSessionToken(account.id, account.installation.id);
      setTenantSessionCookie(res, token);
      res.json({ success: true, data: { authenticated: true } });
    } finally {
      await prisma.$disconnect();
    }
  } catch (err) {
    next(err);
  }
});

tenantAuthRouter.post("/logout", (_req, res) => {
  clearTenantSessionCookie(res);
  res.json({ success: true, data: { authenticated: false } });
});

tenantAuthRouter.get("/session", async (req, res) => {
  const token = req.cookies?.[TENANT_SESSION_COOKIE_NAME];
  const context = token ? await verifyTenantSessionToken(token) : null;
  res.json({ success: true, data: { authenticated: Boolean(context) } });
});

/** Dashboard bootstrap data — the calling tenant's own installation, looked up by account, never "most recent." */
tenantAuthRouter.get("/installation", async (req, res, next) => {
  try {
    const token = req.cookies?.[TENANT_SESSION_COOKIE_NAME];
    const context = token ? await verifyTenantSessionToken(token) : null;
    if (!context) throw new AppError(401, "Not authenticated", "Log in first.", false);

    const databaseUrl = requireDatabaseUrl();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const installation = await prisma.installation.findUnique({ where: { accountId: context.accountId } });
      if (!installation) throw new AppError(404, "No installation found for this account", undefined, false);
      res.json({
        success: true,
        data: {
          id: installation.id,
          installationId: installation.installationId,
          websiteName: installation.websiteName,
          websiteUrl: installation.websiteUrl,
          completedAt: installation.completedAt,
          status: installation.status,
        },
      });
    } finally {
      await prisma.$disconnect();
    }
  } catch (err) {
    next(err);
  }
});

async function requireTenantContext(req: import("express").Request): Promise<{ accountId: string; installationId: string }> {
  const token = req.cookies?.[TENANT_SESSION_COOKIE_NAME];
  const context = token ? await verifyTenantSessionToken(token) : null;
  if (!context) throw new AppError(401, "Not authenticated", "Log in first.", false);
  return context;
}

/**
 * "Delete Chatbot" in the dashboard — a reversible pause, not a real
 * delete. Flips status away from COMPLETED, so every lookup requiring
 * COMPLETED (getActiveInstallationId, chat.routes.ts's /config) stops
 * matching this row on its own — the public widget then hits its
 * existing "Chat is not available right now" fallback (widget.html)
 * with no separate disabled-check needed anywhere else. Nothing on the
 * tenant's own site is touched; only this row.
 */
tenantAuthRouter.post("/installation/disable", async (req, res, next) => {
  try {
    const context = await requireTenantContext(req);
    const databaseUrl = requireDatabaseUrl();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const installation = await prisma.installation.findUnique({ where: { accountId: context.accountId } });
      if (!installation) throw new AppError(404, "No installation found for this account", undefined, false);
      if (installation.status !== "COMPLETED") {
        throw new AppError(409, "Chatbot is not currently active", "Only a completed, active chatbot can be disabled.", false);
      }
      await prisma.installation.update({ where: { id: installation.id }, data: { status: "DISABLED" } });
      res.json({ success: true, data: { status: "DISABLED" } });
    } finally {
      await prisma.$disconnect();
    }
  } catch (err) {
    next(err);
  }
});

tenantAuthRouter.post("/installation/enable", async (req, res, next) => {
  try {
    const context = await requireTenantContext(req);
    const databaseUrl = requireDatabaseUrl();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const installation = await prisma.installation.findUnique({ where: { accountId: context.accountId } });
      if (!installation) throw new AppError(404, "No installation found for this account", undefined, false);
      if (installation.status !== "DISABLED") {
        throw new AppError(409, "Chatbot is not currently disabled", undefined, false);
      }
      await prisma.installation.update({ where: { id: installation.id }, data: { status: "COMPLETED" } });
      res.json({ success: true, data: { status: "COMPLETED" } });
    } finally {
      await prisma.$disconnect();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * Powers the "Add Chatbot" instructions panel — the tech stack detected
 * during the tenant's own onboarding scan (scanOrchestrator.service.ts
 * already writes this to CrawlJob.techStack for every scan; no separate
 * detection step needed). Used to pick the right copy-paste method
 * (plain HTML / Next.js / WordPress / generic) rather than showing every
 * tenant the same one-size instructions.
 */
tenantAuthRouter.get("/tech-stack", async (req, res, next) => {
  try {
    const context = await requireTenantContext(req);
    const databaseUrl = requireDatabaseUrl();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const installation = await prisma.installation.findUnique({ where: { accountId: context.accountId } });
      if (!installation) throw new AppError(404, "No installation found for this account", undefined, false);
      const crawlJob = await prisma.crawlJob.findFirst({
        where: { installationId: installation.id, status: "COMPLETED" },
        orderBy: { startedAt: "desc" },
        select: { techStack: true },
      });
      res.json({ success: true, data: { techStack: crawlJob?.techStack ?? null } });
    } finally {
      await prisma.$disconnect();
    }
  } catch (err) {
    next(err);
  }
});
