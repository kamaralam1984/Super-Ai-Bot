// KVL Enterprise AI Live Chat Engine (Phase 8) — Prisma persistence layer.
// Same one-service-per-phase pattern as every prior phase's record
// service; every other chat/ module stays Prisma-free. `Message.content`
// is encrypted at rest (AES-256-GCM, reusing Phase 3's
// knowledge/security/encryption.ts, same pattern as Phase 5's
// ConnectorCredential) — this is the only place a message's plaintext
// exists outside an in-memory request.

import { PrismaClient, Prisma } from "@prisma/client";
import { encrypt, decrypt } from "../knowledge/security/encryption";
import type { ConversationTurn } from "./memory/shortTermMemory";
import type { ChatIntent } from "./nlu/intentDetector";
import type { ExtractedEntity } from "./nlu/entityExtractor";
import type { SourceReference } from "./citation/sourceReferenceFormatter";
import type { ConversationStatusLike } from "./session/sessionManager";
import type { EscalationChannel, EscalationReason } from "./escalation/escalationEngine";
import type { ConversationSummaryInput, EscalationSummaryInput, MessageSummaryInput } from "./analytics/conversationAnalytics";

function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const LOW_CONFIDENCE_THRESHOLD = 0.35; // matches knowledge/citation/citationFormatter.ts's own answer-confidence floor

export type MessageRoleLike = "USER" | "ASSISTANT" | "SYSTEM";
export type MessageFeedbackLike = "NONE" | "LIKE" | "DISLIKE";
export type EscalationStatusLike = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "CANCELLED";

export interface VisitorRecord {
  id: string;
  installationId: string;
  fingerprint: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  preferredLanguage: string | null;
}

export interface ConversationRecord {
  id: string;
  installationId: string;
  visitorId: string;
  status: ConversationStatusLike;
  language: string | null;
  topicSummary: string | null;
  shareToken: string | null;
  shareTokenExpiresAt: Date | null;
  startedAt: Date;
  lastMessageAt: Date;
  closedAt: Date | null;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: MessageRoleLike;
  content: string;
  intent: ChatIntent | null;
  entities: ExtractedEntity[];
  language: string | null;
  sources: SourceReference[];
  confidence: number | null;
  tookMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  feedback: MessageFeedbackLike;
  regeneratedFromId: string | null;
  createdAt: Date;
}

export interface EscalationTicketRecord {
  id: string;
  conversationId: string;
  installationId: string;
  reason: EscalationReason;
  channel: EscalationChannel;
  status: EscalationStatusLike;
  triggeredBy: string;
  notes: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface SaveMessageParams {
  conversationId: string;
  role: MessageRoleLike;
  content: string;
  intent?: ChatIntent | null;
  entities?: ExtractedEntity[];
  language?: string | null;
  sources?: SourceReference[];
  confidence?: number | null;
  tookMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  regeneratedFromId?: string | null;
}

export interface CreateEscalationTicketParams {
  conversationId: string;
  installationId: string;
  reason: EscalationReason;
  channel: EscalationChannel;
  triggeredBy: string;
  notes?: string | null;
}

export class ChatRecordService {
  private prisma: PrismaClient;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // ── Visitors ─────────────────────────────────────────────────────────

  /** Idempotent — an existing visitor's `lastSeenAt` is refreshed rather than creating a duplicate, keyed on the unique (installationId, fingerprint) pair. */
  async findOrCreateVisitor(installationId: string, fingerprint: string, preferredLanguage?: string | null): Promise<VisitorRecord> {
    const row = await this.prisma.visitor.upsert({
      where: { installationId_fingerprint: { installationId, fingerprint } },
      create: { installationId, fingerprint, preferredLanguage: preferredLanguage ?? null },
      update: { lastSeenAt: new Date(), ...(preferredLanguage ? { preferredLanguage } : {}) },
    });
    return this.mapVisitor(row);
  }

  // ── Conversations ────────────────────────────────────────────────────

  async createConversation(installationId: string, visitorId: string, language: string | null): Promise<ConversationRecord> {
    const row = await this.prisma.conversation.create({ data: { installationId, visitorId, language, status: "ACTIVE" } });
    return this.mapConversation(row);
  }

  async getConversation(conversationId: string): Promise<ConversationRecord | null> {
    const row = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    return row ? this.mapConversation(row) : null;
  }

  /** The visitor's single most recent conversation (by lastMessageAt), for session/sessionManager.ts's recovery decision — only the fields that decision actually needs. */
  async getMostRecentConversationForVisitor(visitorId: string): Promise<{ id: string; status: ConversationStatusLike; lastMessageAt: Date } | null> {
    const row = await this.prisma.conversation.findFirst({ where: { visitorId }, orderBy: { lastMessageAt: "desc" }, select: { id: true, status: true, lastMessageAt: true } });
    return row ? { id: row.id, status: row.status as ConversationStatusLike, lastMessageAt: row.lastMessageAt } : null;
  }

  async touchConversation(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  }

  async updateConversationStatus(conversationId: string, status: ConversationStatusLike): Promise<void> {
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: status as never, closedAt: status === "CLOSED" ? new Date() : undefined } });
  }

  async updateConversationTopicSummary(conversationId: string, topicSummary: string): Promise<void> {
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { topicSummary } });
  }

  async setConversationShareToken(conversationId: string, shareToken: string, expiresAt: Date): Promise<void> {
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { shareToken, shareTokenExpiresAt: expiresAt } });
  }

  async getConversationByShareToken(shareToken: string): Promise<ConversationRecord | null> {
    const row = await this.prisma.conversation.findUnique({ where: { shareToken } });
    return row ? this.mapConversation(row) : null;
  }

  async listConversations(installationId: string, options: { status?: ConversationStatusLike; limit?: number } = {}): Promise<ConversationRecord[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { installationId, ...(options.status ? { status: options.status as never } : {}) },
      orderBy: { lastMessageAt: "desc" },
      take: options.limit ?? 50,
    });
    return rows.map((row) => this.mapConversation(row));
  }

  // ── Messages ─────────────────────────────────────────────────────────

  async saveMessage(params: SaveMessageParams): Promise<MessageRecord> {
    const row = await this.prisma.message.create({
      data: {
        conversationId: params.conversationId,
        role: params.role as never,
        encryptedContent: encrypt(params.content),
        intent: params.intent ?? null,
        entities: params.entities ? toJson(params.entities) : Prisma.JsonNull,
        language: params.language ?? null,
        sources: params.sources ? toJson(params.sources) : Prisma.JsonNull,
        confidence: params.confidence ?? null,
        tookMs: params.tookMs ?? null,
        tokensIn: params.tokensIn ?? null,
        tokensOut: params.tokensOut ?? null,
        regeneratedFromId: params.regeneratedFromId ?? null,
      },
    });
    return this.mapMessage(row, params.content);
  }

  async getMessages(conversationId: string, limit = 200): Promise<MessageRecord[]> {
    const rows = await this.prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, take: limit });
    return rows.map((row) => this.mapMessage(row));
  }

  /** The short-term-memory window source — same rows as `getMessages`, mapped straight into the `ConversationTurn` shape chat/memory/shortTermMemory.ts and chat/context/contextManager.ts consume, so the orchestrator doesn't need its own mapping step. System-role messages are excluded (they're not part of the user/assistant dialogue memory replays). */
  async getRecentTurns(conversationId: string, limit = 50): Promise<ConversationTurn[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return rows.map((row) => ({
      role: row.role === "USER" ? "user" : "assistant",
      content: decrypt(row.encryptedContent),
      intent: row.intent as ChatIntent | null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getMessage(messageId: string): Promise<MessageRecord | null> {
    const row = await this.prisma.message.findUnique({ where: { id: messageId } });
    return row ? this.mapMessage(row) : null;
  }

  async setMessageFeedback(messageId: string, feedback: MessageFeedbackLike): Promise<void> {
    await this.prisma.message.update({ where: { id: messageId }, data: { feedback: feedback as never } });
  }

  async countMessagesInConversation(conversationId: string): Promise<number> {
    return this.prisma.message.count({ where: { conversationId } });
  }

  /** How many of the most recent assistant messages, walking backward from the latest, were ungrounded (null or below the answer-confidence floor) before hitting the first grounded one — what escalation/escalationEngine.ts's `consecutiveUngroundedCount` needs to decide REPEATED_FAILURE/TECHNICAL_BEYOND_KNOWLEDGE. Capped at `lookback` messages so a very long unresolved conversation doesn't require an unbounded scan. */
  async getConsecutiveUngroundedCount(conversationId: string, lookback = 10): Promise<number> {
    const rows = await this.prisma.message.findMany({ where: { conversationId, role: "ASSISTANT" }, orderBy: { createdAt: "desc" }, take: lookback, select: { confidence: true } });
    let count = 0;
    for (const row of rows) {
      if (row.confidence === null || row.confidence < LOW_CONFIDENCE_THRESHOLD) count++;
      else break;
    }
    return count;
  }

  // ── Escalation tickets ───────────────────────────────────────────────

  async createEscalationTicket(params: CreateEscalationTicketParams): Promise<EscalationTicketRecord> {
    const row = await this.prisma.escalationTicket.create({
      data: {
        conversationId: params.conversationId,
        installationId: params.installationId,
        reason: params.reason as never,
        channel: params.channel as never,
        triggeredBy: params.triggeredBy,
        notes: params.notes ?? null,
      },
    });
    return this.mapEscalationTicket(row);
  }

  async listEscalationTickets(installationId: string, options: { status?: EscalationStatusLike; limit?: number } = {}): Promise<EscalationTicketRecord[]> {
    const rows = await this.prisma.escalationTicket.findMany({
      where: { installationId, ...(options.status ? { status: options.status as never } : {}) },
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 100,
    });
    return rows.map((row) => this.mapEscalationTicket(row));
  }

  async updateEscalationStatus(ticketId: string, status: EscalationStatusLike): Promise<void> {
    await this.prisma.escalationTicket.update({ where: { id: ticketId }, data: { status: status as never, resolvedAt: status === "RESOLVED" ? new Date() : undefined } });
  }

  // ── Analytics raw-data fetchers ──────────────────────────────────────
  // Return plain, already-decrypted rows shaped for
  // chat/analytics/conversationAnalytics.ts's pure aggregation — that
  // module never touches Prisma itself.

  async getConversationSummaries(installationId: string, since?: Date): Promise<ConversationSummaryInput[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { installationId, ...(since ? { startedAt: { gte: since } } : {}) },
      select: { id: true, status: true, startedAt: true, lastMessageAt: true, closedAt: true },
    });
    return rows.map((r) => ({ id: r.id, status: r.status as ConversationStatusLike, startedAt: r.startedAt, lastMessageAt: r.lastMessageAt, closedAt: r.closedAt }));
  }

  async getMessageSummaries(installationId: string, since?: Date): Promise<MessageSummaryInput[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversation: { installationId }, ...(since ? { createdAt: { gte: since } } : {}) },
      select: { conversationId: true, role: true, encryptedContent: true, tookMs: true, confidence: true, feedback: true, createdAt: true },
    });
    return rows.map((r) => ({
      conversationId: r.conversationId,
      role: r.role as MessageRoleLike,
      content: decrypt(r.encryptedContent),
      tookMs: r.tookMs,
      confidence: r.confidence,
      feedback: r.feedback as MessageFeedbackLike,
      createdAt: r.createdAt,
    }));
  }

  async getEscalationSummaries(installationId: string, since?: Date): Promise<EscalationSummaryInput[]> {
    const rows = await this.prisma.escalationTicket.findMany({
      where: { installationId, ...(since ? { createdAt: { gte: since } } : {}) },
      select: { conversationId: true, reason: true },
    });
    return rows.map((r) => ({ conversationId: r.conversationId, reason: r.reason }));
  }

  // ── Mappers ──────────────────────────────────────────────────────────

  private mapVisitor(row: { id: string; installationId: string; fingerprint: string; firstSeenAt: Date; lastSeenAt: Date; preferredLanguage: string | null }): VisitorRecord {
    return { id: row.id, installationId: row.installationId, fingerprint: row.fingerprint, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, preferredLanguage: row.preferredLanguage };
  }

  private mapConversation(row: {
    id: string;
    installationId: string;
    visitorId: string;
    status: string;
    language: string | null;
    topicSummary: string | null;
    shareToken: string | null;
    shareTokenExpiresAt: Date | null;
    startedAt: Date;
    lastMessageAt: Date;
    closedAt: Date | null;
  }): ConversationRecord {
    return {
      id: row.id,
      installationId: row.installationId,
      visitorId: row.visitorId,
      status: row.status as ConversationStatusLike,
      language: row.language,
      topicSummary: row.topicSummary,
      shareToken: row.shareToken,
      shareTokenExpiresAt: row.shareTokenExpiresAt,
      startedAt: row.startedAt,
      lastMessageAt: row.lastMessageAt,
      closedAt: row.closedAt,
    };
  }

  private mapMessage(
    row: {
      id: string;
      conversationId: string;
      role: string;
      encryptedContent: string;
      intent: string | null;
      entities: unknown;
      language: string | null;
      sources: unknown;
      confidence: number | null;
      tookMs: number | null;
      tokensIn: number | null;
      tokensOut: number | null;
      feedback: string;
      regeneratedFromId: string | null;
      createdAt: Date;
    },
    knownPlaintext?: string
  ): MessageRecord {
    return {
      id: row.id,
      conversationId: row.conversationId,
      role: row.role as MessageRoleLike,
      content: knownPlaintext ?? decrypt(row.encryptedContent),
      intent: row.intent as ChatIntent | null,
      entities: Array.isArray(row.entities) ? (row.entities as ExtractedEntity[]) : [],
      language: row.language,
      sources: Array.isArray(row.sources) ? (row.sources as SourceReference[]) : [],
      confidence: row.confidence,
      tookMs: row.tookMs,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      feedback: row.feedback as MessageFeedbackLike,
      regeneratedFromId: row.regeneratedFromId,
      createdAt: row.createdAt,
    };
  }

  private mapEscalationTicket(row: {
    id: string;
    conversationId: string;
    installationId: string;
    reason: string;
    channel: string;
    status: string;
    triggeredBy: string;
    notes: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
  }): EscalationTicketRecord {
    return {
      id: row.id,
      conversationId: row.conversationId,
      installationId: row.installationId,
      reason: row.reason as EscalationReason,
      channel: row.channel as EscalationChannel,
      status: row.status as EscalationStatusLike,
      triggeredBy: row.triggeredBy,
      notes: row.notes,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    };
  }
}
