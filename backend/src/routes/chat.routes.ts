// Phase 8 — Enterprise AI Live Chat Engine routes.
//
// IMPORTANT SECURITY DISTINCTION from every other router in this product:
// Phase 2-7's routes are all *internal/admin* surfaces, gated by the
// installation's shared `x-api-key: API_SECRET` — a server-side secret
// that must never reach a browser. Phase 8 is this product's first
// genuinely *public-facing* surface: an anonymous website visitor's
// browser talks to `/api/chat/*` directly from an embedded chat widget.
// Embedding `API_SECRET` in that widget's public JS would leak an admin
// credential to every visitor, so the visitor-facing routes below use no
// such gate — only per-visitor rate limiting and input validation, the
// same security model any public chat product uses. Only the `/admin`
// sub-router (analytics, escalation management, conversation listing —
// genuinely privileged operations) keeps the standard API_SECRET gate.

import { Router } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import {
  startOrResumeConversation,
  processMessage,
  recordMessageFeedback,
  createConversationShareLink,
} from "../chat/chatOrchestrator.service";
import { ChatRecordService } from "../chat/chatRecord.service";
import { computeConversationAnalytics } from "../chat/analytics/conversationAnalytics";
import { isShareTokenValid } from "../chat/session/sessionManager";
import { getActiveInstallationId } from "../scanner/scanRecord.service";
import { verifyApiKey, TokenBucketRateLimiter } from "../knowledge/security/accessControl";
import { recordAuditEvent } from "../knowledge/security/auditLog";
import { AppError } from "../middleware/errorHandler";

export const chatRouter = Router();

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true);
  }
  return databaseUrl;
}

/**
 * Public bootstrap for the embeddable widget (backend/src/routes/widget.routes.ts).
 * This product is single-tenant per deployment — one server, one
 * installation — so the widget's script tag carries no config of its own;
 * it just calls this once on load to learn which installation and
 * business name to use for every subsequent /api/chat/* call. No auth, for
 * the same reason the rest of this router has none: it runs from an
 * anonymous visitor's browser on a third-party site.
 */
chatRouter.get("/config", async (_req, res, next) => {
  try {
    const databaseUrl = requireDatabaseUrl();
    const installationId = await getActiveInstallationId(databaseUrl);
    if (!installationId) {
      next(new AppError(404, "No completed installation yet", "Finish the installer before embedding the chat widget.", true));
      return;
    }
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const installation = await prisma.installation.findUnique({ where: { id: installationId } });
      res.json({ success: true, data: { installationId, businessName: installation?.websiteName ?? "our team" } });
    } finally {
      await prisma.$disconnect();
    }
  } catch (err) {
    next(err);
  }
});

// ── Public, visitor-facing tier ─────────────────────────────────────
// Rate-limited per visitor fingerprint (falling back to IP for a
// brand-new visitor with no fingerprint yet), not per API key — there is
// no API key on this tier. Burst/sustained rates are generous relative to
// the admin routers' (a real conversation is naturally many small
// requests) but still bounded, per the spec's explicit "Rate Limiting"
// requirement.
const PUBLIC_RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 30, refillPerSecond: 3 });

chatRouter.use((req, res, next) => {
  if (req.path.startsWith("/admin")) {
    next();
    return;
  }
  const clientId = (req.header("x-visitor-fingerprint") || req.ip) ?? "unknown";
  if (!PUBLIC_RATE_LIMIT.tryConsume(clientId)) {
    recordAuditEvent({ type: "rate_limited", detail: `client=${clientId} path=${req.path}`, component: "chat-security" });
    next(new AppError(429, "Too many requests", "Slow down and try again shortly.", true));
    return;
  }
  next();
});

const startSessionSchema = z.object({
  installationId: z.string().min(1),
  visitorFingerprint: z.string().optional(),
  preferredLanguage: z.string().optional(),
});

/** Starts a new conversation or resumes the visitor's most recent open one — see chat/session/sessionManager.ts's recovery rule. Always returns a `visitorFingerprint`; the client is responsible for persisting it (localStorage) and sending it back on every subsequent call so "returning visitor" and "resume conversation" work. */
chatRouter.post("/session", async (req, res, next) => {
  const parsed = startSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  try {
    const result = await startOrResumeConversation(requireDatabaseUrl(), parsed.data);
    res.json({
      success: true,
      data: {
        visitorFingerprint: result.visitorFingerprint,
        isNewVisitor: result.isNewVisitor,
        conversationId: result.conversation.id,
        isNewConversation: result.isNewConversation,
        status: result.conversation.status,
        language: result.conversation.language,
      },
    });
  } catch (err) {
    next(err);
  }
});

const sendMessageSchema = z.object({
  installationId: z.string().min(1),
  conversationId: z.string().min(1),
  message: z.string().min(1).max(4000),
  businessName: z.string().min(1),
});

/** Non-streaming REST fallback for sending a message — waits for the complete reply before responding. The WebSocket path (chat/ws/chatSocket.ts's `chat:message` event) is preferred for a real chat UI (token streaming, typing effect); this exists for simple integrations and non-JS clients. */
chatRouter.post("/message", async (req, res, next) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  try {
    const result = await processMessage(requireDatabaseUrl(), parsed.data);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/** Full message history for a conversation — used to restore a chat window on page reload. Access is keyed on knowing the (random, unguessable) `conversationId`, the same access model `shareToken` uses; there is no separate visitor authentication in this product (see docs/CHAT_ENGINE.md). */
chatRouter.get("/conversations/:conversationId/messages", async (req, res, next) => {
  const records = new ChatRecordService(requireDatabaseUrl());
  try {
    const messages = await records.getMessages(req.params.conversationId);
    res.json({ success: true, data: messages });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

const feedbackSchema = z.object({ feedback: z.enum(["LIKE", "DISLIKE", "NONE"]) });

/** Like/Dislike (or clearing feedback) on one assistant message. */
chatRouter.post("/messages/:messageId/feedback", async (req, res, next) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  try {
    await recordMessageFeedback(requireDatabaseUrl(), req.params.messageId, parsed.data.feedback);
    res.json({ success: true, data: { recorded: true } });
  } catch (err) {
    next(err);
  }
});

/** Creates (or rotates) a share link for a conversation — the "Share Conversation" feature. */
chatRouter.post("/conversations/:conversationId/share", async (req, res, next) => {
  try {
    const result = await createConversationShareLink(requireDatabaseUrl(), req.params.conversationId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/** Public, read-only view of a shared conversation — anyone holding the token can read it (that's the point of a share link), but a missing/expired token is a 404, not a hint that the conversation exists. */
chatRouter.get("/shared/:shareToken", async (req, res, next) => {
  const records = new ChatRecordService(requireDatabaseUrl());
  try {
    const conversation = await records.getConversationByShareToken(req.params.shareToken);
    if (!conversation || !isShareTokenValid(conversation.shareTokenExpiresAt)) {
      throw new AppError(404, "Share link not found or expired", "Ask the conversation owner for a fresh link.", false);
    }
    const messages = await records.getMessages(conversation.id);
    res.json({ success: true, data: { conversation, messages } });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

/** Conversation Export — the full transcript as JSON, or as plain text with `?format=text`. */
chatRouter.get("/conversations/:conversationId/export", async (req, res, next) => {
  const records = new ChatRecordService(requireDatabaseUrl());
  try {
    const conversation = await records.getConversation(req.params.conversationId);
    if (!conversation) {
      throw new AppError(404, "Conversation not found", "Check the conversation id.", false);
    }
    const messages = await records.getMessages(conversation.id);

    if (req.query.format === "text") {
      const transcript = messages.map((m) => `[${m.createdAt.toISOString()}] ${m.role}: ${m.content}`).join("\n\n");
      res.type("text/plain").send(transcript);
      return;
    }

    res.json({ success: true, data: { conversation, messages } });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

// ── Admin tier — same API_SECRET + rate-limit gate as every other
// authenticated API in this product. ────────────────────────────────

const adminRouter = Router();
const ADMIN_RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 20, refillPerSecond: 2 });

adminRouter.use((req, res, next) => {
  const apiKey = req.header("x-api-key");
  const expected = process.env.API_SECRET;
  const clientId = apiKey ?? req.ip ?? "unknown";

  if (!ADMIN_RATE_LIMIT.tryConsume(clientId)) {
    recordAuditEvent({ type: "rate_limited", detail: `client=${clientId} path=${req.path}`, component: "chat-admin-security" });
    next(new AppError(429, "Too many requests", "Slow down and try again shortly.", true));
    return;
  }
  if (!expected || !verifyApiKey(apiKey, expected)) {
    recordAuditEvent({ type: "access_denied", detail: `client=${clientId} path=${req.path}`, component: "chat-admin-security" });
    next(new AppError(401, "Invalid or missing API key", "Pass the installation's API_SECRET as the x-api-key header.", false));
    return;
  }
  next();
});

adminRouter.get("/conversations", async (req, res, next) => {
  const installationId = typeof req.query.installationId === "string" ? req.query.installationId : undefined;
  if (!installationId) {
    next(new AppError(400, "installationId query parameter is required", "Pass ?installationId=... .", true));
    return;
  }
  const status = typeof req.query.status === "string" ? (req.query.status as "ACTIVE" | "IDLE" | "ESCALATED" | "CLOSED") : undefined;
  const records = new ChatRecordService(requireDatabaseUrl());
  try {
    const conversations = await records.listConversations(installationId, { status });
    res.json({ success: true, data: conversations });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

adminRouter.get("/conversations/:conversationId/messages", async (req, res, next) => {
  const records = new ChatRecordService(requireDatabaseUrl());
  try {
    const messages = await records.getMessages(req.params.conversationId);
    res.json({ success: true, data: messages });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

adminRouter.get("/escalations", async (req, res, next) => {
  const installationId = typeof req.query.installationId === "string" ? req.query.installationId : undefined;
  if (!installationId) {
    next(new AppError(400, "installationId query parameter is required", "Pass ?installationId=... .", true));
    return;
  }
  const status = typeof req.query.status === "string" ? (req.query.status as "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "CANCELLED") : undefined;
  const records = new ChatRecordService(requireDatabaseUrl());
  try {
    const tickets = await records.listEscalationTickets(installationId, { status });
    res.json({ success: true, data: tickets });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

const updateEscalationSchema = z.object({ status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "CANCELLED"]) });

adminRouter.patch("/escalations/:ticketId", async (req, res, next) => {
  const parsed = updateEscalationSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  const records = new ChatRecordService(requireDatabaseUrl());
  try {
    await records.updateEscalationStatus(req.params.ticketId, parsed.data.status);
    res.json({ success: true, data: { updated: true } });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

/** Conversation Analytics — see chat/analytics/conversationAnalytics.ts for what's computed and honest documentation of what "AI Accuracy"/"Knowledge Coverage" actually measure here. `?sinceDays=` narrows the window; omit for all-time. */
adminRouter.get("/analytics", async (req, res, next) => {
  const installationId = typeof req.query.installationId === "string" ? req.query.installationId : undefined;
  if (!installationId) {
    next(new AppError(400, "installationId query parameter is required", "Pass ?installationId=... .", true));
    return;
  }
  const sinceDays = typeof req.query.sinceDays === "string" ? Number(req.query.sinceDays) : undefined;
  const since = sinceDays && Number.isFinite(sinceDays) ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000) : undefined;

  const records = new ChatRecordService(requireDatabaseUrl());
  try {
    const [conversations, messages, escalations] = await Promise.all([
      records.getConversationSummaries(installationId, since),
      records.getMessageSummaries(installationId, since),
      records.getEscalationSummaries(installationId, since),
    ]);
    const report = computeConversationAnalytics({ conversations, messages, escalations });
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

chatRouter.use("/admin", adminRouter);
