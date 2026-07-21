import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { verifyApiKey, TokenBucketRateLimiter } from "../knowledge/security/accessControl";
import { recordAuditEvent } from "../knowledge/security/auditLog";
import { createSessionToken, setSessionCookie, clearSessionCookie, verifySessionToken, SESSION_COOKIE_NAME } from "../middleware/adminSession";
import { AppError } from "../middleware/errorHandler";

export const adminAuthRouter = Router();

// A dedicated, tighter rate limit than the general admin-API zones — this
// is exactly the endpoint a credential-stuffing attempt would target.
const LOGIN_RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 5, refillPerSecond: 0.1 });

const loginSchema = z.object({ apiSecret: z.string().min(1) });

adminAuthRouter.post("/login", async (req, res, next) => {
  try {
    const clientId = req.ip ?? "unknown";
    if (!LOGIN_RATE_LIMIT.tryConsume(clientId)) {
      recordAuditEvent({ type: "rate_limited", detail: `client=${clientId} path=/api/admin/login`, component: "admin-auth" });
      throw new AppError(429, "Too many login attempts", "Wait a few minutes and try again.", true);
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid request body", "Provide { apiSecret }.", true);

    const expected = process.env.API_SECRET;
    if (!expected || !verifyApiKey(parsed.data.apiSecret, expected)) {
      recordAuditEvent({ type: "access_denied", detail: `client=${clientId} path=/api/admin/login`, component: "admin-auth" });
      throw new AppError(401, "Invalid API secret", undefined, false);
    }

    const token = await createSessionToken();
    setSessionCookie(res, token);
    res.json({ success: true, data: { authenticated: true } });
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true, data: { authenticated: false } });
});

adminAuthRouter.get("/session", async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const authenticated = Boolean(token && (await verifySessionToken(token)));
  res.json({ success: true, data: { authenticated } });
});

/**
 * Dashboard bootstrap data — the single COMPLETED installation this
 * single-tenant instance manages. Requires a valid session (checked
 * directly here, not via the generic `x-api-key` injection middleware,
 * since this route is under /api/admin which app.ts mounts *before* that
 * middleware runs).
 */
adminAuthRouter.get("/installation", async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token || !(await verifySessionToken(token))) {
      throw new AppError(401, "Not authenticated", "Log in first.", false);
    }
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new AppError(400, "No database configured", "Complete the installer first.", true);

    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const installation = await prisma.installation.findFirst({ where: { status: "COMPLETED" }, orderBy: { startedAt: "desc" } });
      if (!installation) throw new AppError(404, "No completed installation found", undefined, false);
      res.json({
        success: true,
        data: { id: installation.id, installationId: installation.installationId, websiteName: installation.websiteName, websiteUrl: installation.websiteUrl, completedAt: installation.completedAt },
      });
    } finally {
      await prisma.$disconnect();
    }
  } catch (err) {
    next(err);
  }
});
