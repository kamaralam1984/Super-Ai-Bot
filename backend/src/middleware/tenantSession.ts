// SaaS tenant session — same backend-for-frontend pattern as
// adminSession.ts, kept as a fully separate cookie/module rather than
// extending that one: a tenant is not "the" admin (there is now more than
// one installation), and the two session types must be able to coexist in
// the same browser (KVL staff testing a tenant signup while also logged
// into their own super-admin dashboard) without either overwriting the
// other's cookie.
//
// jose is ESM-only; this project is CommonJS, so it's dynamically
// imported at call time — mirrors adminSession.ts's own reasoning.

import type { Request, Response, NextFunction } from "express";
import { bootConfig } from "../config/env";

export const TENANT_SESSION_COOKIE_NAME = "kvl_tenant_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60; // matches adminSession.ts's TTL

export interface TenantContext {
  accountId: string;
  installationId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
    }
  }
}

function getJwtSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured — complete the installer first.");
  return new TextEncoder().encode(secret);
}

export async function createTenantSessionToken(accountId: string, installationId: string): Promise<string> {
  const { SignJWT } = await import("jose");
  return new SignJWT({ sub: accountId, installationId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getJwtSecretKey());
}

export async function verifyTenantSessionToken(token: string): Promise<TenantContext | null> {
  try {
    const { jwtVerify } = await import("jose");
    const { payload } = await jwtVerify(token, getJwtSecretKey());
    if (typeof payload.sub !== "string" || typeof payload.installationId !== "string") return null;
    return { accountId: payload.sub, installationId: payload.installationId };
  } catch {
    return null;
  }
}

export function setTenantSessionCookie(res: Response, token: string): void {
  res.cookie(TENANT_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: bootConfig.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
}

export function clearTenantSessionCookie(res: Response): void {
  res.clearCookie(TENANT_SESSION_COOKIE_NAME, { path: "/" });
}

/**
 * Mounted globally alongside injectApiKeyFromSession. A valid tenant
 * session cookie does two things: (1) attaches x-api-key exactly like the
 * admin session does, reusing every existing admin-tier router's auth
 * gate unchanged — the tenant is a legitimate holder of the one shared
 * API_SECRET, not a second secret; ownership is enforced by
 * tenantContext.ts's resolveInstallationId, not by which secret was
 * presented — and (2) attaches req.tenantContext so that resolver can
 * scope every subsequent lookup to this tenant's own installation.
 */
export async function injectTenantContext(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[TENANT_SESSION_COOKIE_NAME];
  if (token) {
    const context = await verifyTenantSessionToken(token);
    if (context) {
      req.tenantContext = context;
      if (process.env.API_SECRET) req.headers["x-api-key"] = process.env.API_SECRET;
    }
  }
  next();
}
