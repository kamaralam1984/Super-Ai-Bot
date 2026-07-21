// Admin dashboard session — a backend-for-frontend auth layer so the
// browser-facing admin dashboard SPA never holds the raw `API_SECRET`
// every Phase 2-11 admin API already requires (that header check is
// unchanged — see knowledge.routes.ts/training.routes.ts/monitor.routes.ts/
// deployment.routes.ts's own middleware). Login exchanges the API_SECRET
// (entered once, over HTTPS in production) for a short-lived, signed,
// HttpOnly session cookie; `injectApiKeyFromSession` below then silently
// re-attaches the real `x-api-key` header server-side on every
// subsequent request carrying a valid cookie, so none of those existing
// route-level gates needed to change at all.
//
// jose is ESM-only; this project is CommonJS, so it's dynamically
// imported at call time — the same pattern connector/auth/oidcDiscovery.ts
// already established for the same reason.

import type { Request, Response, NextFunction } from "express";
import { verifyApiKey } from "../knowledge/security/accessControl";
import { bootConfig } from "../config/env";

export const SESSION_COOKIE_NAME = "kvl_admin_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h — long enough for a working session, short enough that a stolen cookie doesn't grant indefinite access

function getJwtSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured — complete the installer first.");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(): Promise<string> {
  const { SignJWT } = await import("jose");
  return new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getJwtSecretKey());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { jwtVerify } = await import("jose");
    const { payload } = await jwtVerify(token, getJwtSecretKey());
    return payload.sub === "admin";
  } catch {
    return false;
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: bootConfig.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

/**
 * Mounted globally, ahead of every route — a request with no cookie or an
 * invalid/expired one is untouched (falls through to each route's own
 * existing `x-api-key` requirement, which will correctly reject it). A
 * request with a *valid* session cookie gets `x-api-key` attached
 * server-side before it reaches any router, so the dashboard SPA's fetch
 * calls never need to know the real secret at all — only this process
 * ever reads process.env.API_SECRET into the request.
 */
export async function injectApiKeyFromSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (token && (await verifySessionToken(token)) && process.env.API_SECRET) {
    req.headers["x-api-key"] = process.env.API_SECRET;
  }
  next();
}
