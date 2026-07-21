// WebSocket Architecture (Phase 8) — token-streaming chat over the
// existing Socket.IO server. Registered as an *additional* `connection`
// listener (see registerChatSocketHandlers's call site in index.ts) rather
// than by editing ws/socket.ts itself — Socket.IO fires every registered
// `connection` listener for a given connection, so this is purely
// additive to Phase 1's installer-progress listener, not a modification
// of it.
//
// No API_SECRET gate here either, for the same reason chat.routes.ts's
// public tier has none: a visitor's browser holds this socket, and an
// admin secret must never reach it. Per-socket rate limiting is this
// layer's actual defense against abuse.

import type { Server as SocketIOServer, Socket } from "socket.io";
import { z } from "zod";
import { processMessage, startOrResumeConversation } from "../chatOrchestrator.service";
import { TokenBucketRateLimiter } from "../../knowledge/security/accessControl";
import { recordAuditEvent } from "../../knowledge/security/auditLog";
import { logEvent } from "../../utils/logger";
import { formatError } from "../../utils/formatError";

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("No database configured — complete the installer (Phase 1) first.");
  }
  return databaseUrl;
}

const startSchema = z.object({
  installationId: z.string().min(1),
  visitorFingerprint: z.string().optional(),
  preferredLanguage: z.string().optional(),
});

const messageSchema = z.object({
  installationId: z.string().min(1),
  conversationId: z.string().min(1),
  message: z.string().min(1).max(4000),
  businessName: z.string().min(1),
});

const SOCKET_RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 20, refillPerSecond: 2 });

/** Registers the `chat:start` / `chat:message` event handlers on every future connection to the shared Socket.IO server. Idempotent to call once at startup (see backend/src/index.ts); calling it twice would double-register handlers, so it isn't designed to be called more than once per process. */
export function registerChatSocketHandlers(io: SocketIOServer): void {
  io.on("connection", (socket: Socket) => {
    socket.on("chat:start", async (payload: unknown) => {
      const parsed = startSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("chat:error", { message: parsed.error.issues.map((i) => i.message).join("; ") });
        return;
      }
      try {
        const result = await startOrResumeConversation(requireDatabaseUrl(), parsed.data);
        socket.emit("chat:started", {
          visitorFingerprint: result.visitorFingerprint,
          isNewVisitor: result.isNewVisitor,
          conversationId: result.conversation.id,
          isNewConversation: result.isNewConversation,
          status: result.conversation.status,
          language: result.conversation.language,
        });
      } catch (err) {
        logEvent({ component: "chat-socket", message: "chat:start failed", status: "error", error: formatError(err) });
        socket.emit("chat:error", { message: formatError(err) });
      }
    });

    socket.on("chat:message", async (payload: unknown) => {
      const parsed = messageSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("chat:error", { message: parsed.error.issues.map((i) => i.message).join("; ") });
        return;
      }

      const clientId = parsed.data.conversationId;
      if (!SOCKET_RATE_LIMIT.tryConsume(clientId)) {
        recordAuditEvent({ type: "rate_limited", detail: `conversation=${clientId} channel=websocket`, component: "chat-security" });
        socket.emit("chat:error", { message: "You're sending messages too quickly — please slow down." });
        return;
      }

      try {
        socket.emit("chat:thinking", { conversationId: parsed.data.conversationId });
        const result = await processMessage(requireDatabaseUrl(), {
          ...parsed.data,
          onDelta: (delta) => socket.emit("chat:delta", { conversationId: parsed.data.conversationId, delta }),
        });
        socket.emit("chat:complete", result);
      } catch (err) {
        logEvent({ component: "chat-socket", message: "chat:message failed", status: "error", error: formatError(err) });
        socket.emit("chat:error", { conversationId: parsed.data.conversationId, message: formatError(err) });
      }
    });
  });
}
