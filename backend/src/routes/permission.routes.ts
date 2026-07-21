import { Router } from "express";
import { z } from "zod";
import { PermissionOrchestratorService } from "../permission/permissionOrchestrator.service";
import { listDataScopeDefinitions } from "../permission/catalog/dataScopeCatalog";
import { ALL_DATA_SCOPES } from "../permission/types";
import { verifyApiKey, TokenBucketRateLimiter } from "../knowledge/security/accessControl";
import { recordAuditEvent } from "../knowledge/security/auditLog";
import { AppError } from "../middleware/errorHandler";

export const permissionRouter = Router();

const RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 20, refillPerSecond: 2 });

/**
 * The static data-category catalog — registered *before* the router-wide
 * auth gate below on purpose. It's read-only, holds no installation- or
 * business-specific data (just the 12 fixed scope definitions), and is
 * exactly what the public, pre-install permission-consent screen
 * (frontend/src/pages/steps/PermissionConsentStep.tsx) needs to render its
 * checklist before an installation — and therefore an API_SECRET — even
 * exists yet.
 */
permissionRouter.get("/scopes", (_req, res) => {
  res.json({ success: true, data: listDataScopeDefinitions() });
});

/** Same API_SECRET + per-caller rate-limit gate as every other authenticated API in this product — this router grants/revokes the AI's access to business data, so it is not something to leave unauthenticated (except the public catalog route registered above, which carries no such data). */
permissionRouter.use((req, res, next) => {
  const apiKey = req.header("x-api-key");
  const expected = process.env.API_SECRET;
  const clientId = apiKey ?? req.ip ?? "unknown";

  if (!RATE_LIMIT.tryConsume(clientId)) {
    recordAuditEvent({ type: "rate_limited", detail: `client=${clientId} path=${req.path}`, component: "permission-security" });
    next(new AppError(429, "Too many requests", "Slow down and try again shortly.", true));
    return;
  }

  if (!expected || !verifyApiKey(apiKey, expected)) {
    recordAuditEvent({ type: "access_denied", detail: `client=${clientId} path=${req.path}`, component: "permission-security" });
    next(new AppError(401, "Invalid or missing API key", "Pass the installation's API_SECRET as the x-api-key header.", false));
    return;
  }

  next();
});

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true);
  }
  return databaseUrl;
}

const dataScopeSchema = z.enum(ALL_DATA_SCOPES as [string, ...string[]]);

/** Current wizard state for an installation's own knowledge base (no connectorId) or one specific Phase 5 connector. */
permissionRouter.get("/wizard", async (req, res, next) => {
  const installationId = typeof req.query.installationId === "string" ? req.query.installationId : undefined;
  const connectorId = typeof req.query.connectorId === "string" ? req.query.connectorId : null;
  if (!installationId) {
    next(new AppError(400, "installationId query parameter is required", "Pass ?installationId=... .", true));
    return;
  }
  const orchestrator = new PermissionOrchestratorService(requireDatabaseUrl());
  try {
    const state = await orchestrator.getWizardState(installationId, connectorId);
    res.json({ success: true, data: state });
  } catch (err) {
    next(err);
  } finally {
    await orchestrator.close();
  }
});

// `.nullish()` (not `.optional()`) on every `connectorId` field in this
// file: every handler below does `parsed.data.connectorId ?? null`, so
// `null` ("no connector" — the installation-level wizard, e.g.
// PermissionWizard.tsx's default) was always the intended value here,
// just never accepted by validation until a real caller sent it
// explicitly instead of omitting the key — caught via the admin
// dashboard's live PermissionWizard submission failing with a real 400.
const wizardSubmissionSchema = z.object({
  installationId: z.string().min(1),
  connectorId: z.string().min(1).nullish(),
  grantedScopes: z.array(dataScopeSchema).max(ALL_DATA_SCOPES.length),
  actor: z.string().min(1),
  notes: z.string().optional(),
});

/** Applies a full wizard submission — grants every newly-checked scope, revokes every unchecked one that was previously active, leaves the rest untouched. This is the primary way an administrator authorizes chatbot access. */
permissionRouter.post("/wizard", async (req, res, next) => {
  const parsed = wizardSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  const orchestrator = new PermissionOrchestratorService(requireDatabaseUrl());
  try {
    const result = await orchestrator.submitWizard({
      installationId: parsed.data.installationId,
      connectorId: parsed.data.connectorId ?? null,
      grantedScopes: parsed.data.grantedScopes as never,
      actor: parsed.data.actor,
      notes: parsed.data.notes,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  } finally {
    await orchestrator.close();
  }
});

const grantBodySchema = z.object({
  installationId: z.string().min(1),
  connectorId: z.string().min(1).nullish(),
  dataScope: dataScopeSchema,
  grantedBy: z.string().min(1),
  notes: z.string().optional(),
});

/** Grants a single scope — a lighter-weight alternative to a full wizard submission, for an admin UI that lets an operator toggle one category at a time. */
permissionRouter.post("/grant", async (req, res, next) => {
  const parsed = grantBodySchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  const orchestrator = new PermissionOrchestratorService(requireDatabaseUrl());
  try {
    const result = await orchestrator.submitWizard({
      installationId: parsed.data.installationId,
      connectorId: parsed.data.connectorId ?? null,
      grantedScopes: [parsed.data.dataScope as never],
      actor: parsed.data.grantedBy,
      notes: parsed.data.notes,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  } finally {
    await orchestrator.close();
  }
});

const revokeBodySchema = z.object({
  installationId: z.string().min(1),
  connectorId: z.string().min(1).nullish(),
  dataScope: dataScopeSchema,
  revokedBy: z.string().min(1),
});

permissionRouter.post("/revoke", async (req, res, next) => {
  const parsed = revokeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  const orchestrator = new PermissionOrchestratorService(requireDatabaseUrl());
  try {
    const currentState = await orchestrator.getWizardState(parsed.data.installationId, parsed.data.connectorId ?? null);
    const remaining = currentState.options.filter((o) => o.granted && o.scope !== parsed.data.dataScope).map((o) => o.scope);
    const result = await orchestrator.submitWizard({
      installationId: parsed.data.installationId,
      connectorId: parsed.data.connectorId ?? null,
      grantedScopes: remaining,
      actor: parsed.data.revokedBy,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  } finally {
    await orchestrator.close();
  }
});

/** Full grant history (active + revoked) for an installation, optionally narrowed to one connector — the admin UI's "who authorized what, and when" view. */
permissionRouter.get("/grants", async (req, res, next) => {
  const installationId = typeof req.query.installationId === "string" ? req.query.installationId : undefined;
  if (!installationId) {
    next(new AppError(400, "installationId query parameter is required", "Pass ?installationId=... .", true));
    return;
  }
  const connectorId = typeof req.query.connectorId === "string" ? req.query.connectorId : undefined;
  const orchestrator = new PermissionOrchestratorService(requireDatabaseUrl());
  try {
    const grants = await orchestrator.listGrants(installationId, connectorId);
    res.json({ success: true, data: grants });
  } catch (err) {
    next(err);
  } finally {
    await orchestrator.close();
  }
});

/** The Permission Engine's own audit trail — grants, revocations, and every access check (allowed or denied) made against it. */
permissionRouter.get("/events", async (req, res, next) => {
  const installationId = typeof req.query.installationId === "string" ? req.query.installationId : undefined;
  if (!installationId) {
    next(new AppError(400, "installationId query parameter is required", "Pass ?installationId=... .", true));
    return;
  }
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const orchestrator = new PermissionOrchestratorService(requireDatabaseUrl());
  try {
    const events = await orchestrator.listEvents(installationId, limit);
    res.json({ success: true, data: events });
  } catch (err) {
    next(err);
  } finally {
    await orchestrator.close();
  }
});

const checkBodySchema = z.object({
  installationId: z.string().min(1),
  connectorId: z.string().min(1).nullish(),
  dataScope: dataScopeSchema,
  purpose: z.string().min(1),
});

/** Debug/diagnostic endpoint — evaluates one access request without performing any data read, useful for an admin UI explaining why a given AI tool call would be blocked. Internal consumers (the Training Engine, the AI tool layer) call PermissionOrchestratorService.checkAccess() directly in-process rather than over HTTP. */
permissionRouter.post("/check", async (req, res, next) => {
  const parsed = checkBodySchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  const orchestrator = new PermissionOrchestratorService(requireDatabaseUrl());
  try {
    const decision = await orchestrator.checkAccess({
      installationId: parsed.data.installationId,
      connectorId: parsed.data.connectorId ?? null,
      dataScope: parsed.data.dataScope as never,
      purpose: parsed.data.purpose,
    });
    res.json({ success: true, data: decision });
  } catch (err) {
    next(err);
  } finally {
    await orchestrator.close();
  }
});
