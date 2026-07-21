// KVL Enterprise AI Live Chat Engine (Phase 8) — top-level orchestrator.
// Implements the spec's RAG pipeline end to end: Receive User Query →
// Intent Detection → Language Detection → Semantic Search → Retrieve Top
// Knowledge Chunks → Rank Results → Verify Sources → Generate Final Prompt
// → Generate AI Response → Attach Source References → Store Conversation
// — plus escalation evaluation and long-term-memory updates that happen
// alongside it. Every prior chat/ module is pure; this is the one place
// that composes them with real I/O (Prisma via chatRecord.service.ts, the
// LLM provider, Phase 5's connectors via Phase 7's authorized tool layer).

import { ChatRecordService, type ConversationRecord } from "./chatRecord.service";
import { ConnectorRecordService } from "../connector/connectorRecord.service";
import { selectConnectorForCategory, withFailover, type ConnectorCandidate } from "../connector/manage/connectionManager";
import { PermissionOrchestratorService } from "../permission/permissionOrchestrator.service";
import { getLlmProvider } from "./llm/providerFactory";
import { detectIntent, type ChatIntent } from "./nlu/intentDetector";
import { extractEntities, type ExtractedEntity } from "./nlu/entityExtractor";
import { detectChunkLanguage, isSupportedLanguage } from "../knowledge/language/multiLanguage";
import { buildContext } from "./context/contextManager";
import { retrieveFromConnector, retrieveKnowledge, type RetrievalResult } from "./retrieval/ragRetriever";
import { buildPromptMessages } from "./prompt/promptBuilder";
import { evaluateGrounding, buildRefusalMessage, auditResponseGrounding, type GroundingAudit } from "./hallucination/groundingGuard";
import { generateResponse, streamResponse } from "./generate/responseGenerator";
import { deriveQuickActions, deriveSuggestedQuestions, type QuickAction } from "./suggest/suggestedReplyEngine";
import { evaluateEscalation } from "./escalation/escalationEngine";
import { resolveVisitorIdentity, decideConversationRecovery, generateShareToken, computeShareTokenExpiry } from "./session/sessionManager";
import { sanitizeUserInput } from "./security/inputSanitizer";
import { detectPromptInjection } from "./security/promptInjectionGuard";
import { summarizeTurnForMemory, updateTopicSummary } from "./memory/longTermMemory";
import { recordAuditEvent } from "../knowledge/security/auditLog";
import { logEvent } from "../utils/logger";
import type { SourceReference } from "./citation/sourceReferenceFormatter";
import type { EndpointCategory } from "../connector/types";

// ── Start / resume a conversation ─────────────────────────────────────

export interface StartConversationParams {
  installationId: string;
  visitorFingerprint?: string | null;
  preferredLanguage?: string | null;
}

export interface StartConversationResult {
  visitorFingerprint: string;
  isNewVisitor: boolean;
  conversation: ConversationRecord;
  isNewConversation: boolean;
}

/** Resolves visitor identity (new vs. returning) and decides whether to resume the visitor's most recent conversation or start a fresh one — see session/sessionManager.ts for the recovery rule. */
export async function startOrResumeConversation(databaseUrl: string, params: StartConversationParams): Promise<StartConversationResult> {
  const records = new ChatRecordService(databaseUrl);
  try {
    // A caller-supplied preferredLanguage (e.g. the embeddable widget's
    // `navigator.language`, an IETF tag like "en-US") is a completely
    // different vocabulary from the canonical names this product's own
    // language detector produces ("English", "Hindi", ...) — and
    // conversation.language, once set, permanently overrides per-message
    // auto-detection for every future retrieval in this conversation
    // (see the `language` resolution below). An unrecognized value stored
    // there doesn't just get ignored, it becomes a strict equality filter
    // in getSearchCandidates() that no real KnowledgeChunk.language value
    // can ever match, silently returning zero candidates for the entire
    // conversation. Verified live: this exact bug made a real 909-chunk,
    // fully-trained knowledge base answer "I don't have verified
    // information" to every question, for every real browser client
    // (navigator.language is never a canonical name). Only trust it when
    // it's actually a supported canonical value; otherwise fall back to
    // the same per-message auto-detection used when no hint is given.
    const preferredLanguage = params.preferredLanguage && isSupportedLanguage(params.preferredLanguage) ? params.preferredLanguage : null;

    const identity = resolveVisitorIdentity(params.visitorFingerprint);
    const visitor = await records.findOrCreateVisitor(params.installationId, identity.fingerprint, preferredLanguage);

    const existingSummary = await records.getMostRecentConversationForVisitor(visitor.id);
    const recoveryDecision = decideConversationRecovery(existingSummary ? { status: existingSummary.status, lastMessageAt: existingSummary.lastMessageAt } : null);

    let conversation: ConversationRecord;
    let isNewConversation: boolean;
    if (recoveryDecision.action === "resume" && existingSummary) {
      const resumed = await records.getConversation(existingSummary.id);
      if (!resumed) throw new Error(`Conversation ${existingSummary.id} was found in the recovery lookup but vanished before it could be fetched.`);
      conversation = resumed;
      isNewConversation = false;
    } else {
      conversation = await records.createConversation(params.installationId, visitor.id, preferredLanguage);
      isNewConversation = true;
    }

    recordAuditEvent({
      type: "chat_conversation_started",
      detail: `installation=${params.installationId} conversation=${conversation.id} resumed=${!isNewConversation} reason="${recoveryDecision.reason}"`,
      component: "chat-security",
    });

    return { visitorFingerprint: identity.fingerprint, isNewVisitor: !identity.isReturning, conversation, isNewConversation };
  } finally {
    await records.close();
  }
}

// ── Retrieval routing ────────────────────────────────────────────────

/** Intents structurally impossible to answer from crawled website content — real-time system-of-record state, not something a website scan could ever have captured. Everything else is served from the crawled knowledge base, which is always available (a Phase 5 connector is optional infrastructure not every installation configures). */
const CONNECTOR_PREFERRED_INTENTS = new Set<ChatIntent>(["order_status", "appointment_inquiry", "inventory_inquiry"]);

const INTENT_TO_ENDPOINT_CATEGORY: Partial<Record<ChatIntent, EndpointCategory>> = {
  order_status: "orders",
  appointment_inquiry: "appointments",
  inventory_inquiry: "inventory",
};

/**
 * When more than one connector can serve the relevant category (e.g. an
 * installation with both a live ERP connector and a legacy booking-system
 * connector, both capable of "appointments"), this tries them in
 * Connector.priority order (connector/manage/connectionManager.ts) and
 * automatically fails over to the next one if a higher-priority connector
 * is unreachable or returns nothing — rather than the single, unordered
 * "first CONNECTED connector found" this used before Phase 9. If every
 * connector fails (or none is configured at all), this falls back to the
 * crawled knowledge base rather than a hard refusal — a connector is
 * always *preferred* for these intents, never *required*.
 */
async function retrieveEvidence(
  databaseUrl: string,
  params: { installationId: string; intent: ChatIntent; message: string; language: string; entities: ExtractedEntity[]; permissions: PermissionOrchestratorService; connectorRecords: ConnectorRecordService }
): Promise<RetrievalResult> {
  const category = INTENT_TO_ENDPOINT_CATEGORY[params.intent];
  if (category) {
    const connectors = await params.connectorRecords.listConnectors(params.installationId);
    const candidates: ConnectorCandidate[] = await Promise.all(
      connectors.map(async (connector) => ({ connector, hasCategoryEndpoint: (await params.connectorRecords.getEndpointForCategory(connector.id, category)) !== null }))
    );
    const ordered = selectConnectorForCategory(candidates, category);

    if (ordered.length > 0) {
      const orderIdEntity = params.entities.find((e) => e.type === "order_id");
      const failover = await withFailover(
        ordered,
        (connector) => retrieveFromConnector(params.permissions, params.connectorRecords, connector, { intent: params.intent, orderId: orderIdEntity?.value }),
        (result) => result.answered
      );
      if (failover.succeeded && failover.result) {
        return failover.result;
      }
    }
  }
  return retrieveKnowledge(databaseUrl, { installationId: params.installationId, query: params.message, intent: params.intent, language: params.language });
}

// ── Process one turn ─────────────────────────────────────────────────

export interface ProcessMessageParams {
  installationId: string;
  conversationId: string;
  message: string;
  businessName: string;
  /** When supplied, the response is generated via streamResponse() and every token is forwarded here as it arrives (the WebSocket path). Omit for the non-streaming REST fallback. */
  onDelta?: (delta: string) => void;
}

export interface ProcessMessageResult {
  userMessageId: string;
  assistantMessageId: string;
  content: string;
  intent: ChatIntent;
  language: string;
  sources: SourceReference[];
  confidence: number | null;
  suggestedQuestions: string[];
  quickActions: QuickAction[];
  escalated: boolean;
  escalationTicketId: string | null;
  groundingAudit: GroundingAudit;
  tookMs: number;
}

/** The full per-turn RAG pipeline. Persists both the visitor's message and the assistant's reply regardless of what happens in between (a generation failure still leaves the visitor's own message on record), evaluates escalation triggers, and updates the conversation's rolling long-term-memory summary. */
export async function processMessage(databaseUrl: string, params: ProcessMessageParams): Promise<ProcessMessageResult> {
  const startedAt = Date.now();
  const records = new ChatRecordService(databaseUrl);
  const permissions = new PermissionOrchestratorService(databaseUrl);
  const connectorRecords = new ConnectorRecordService(databaseUrl);

  try {
    const conversation = await records.getConversation(params.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${params.conversationId} not found.`);
    }

    const sanitized = sanitizeUserInput(params.message);

    const injectionCheck = detectPromptInjection(sanitized);
    if (injectionCheck.suspicious) {
      recordAuditEvent({ type: "chat_prompt_injection_detected", detail: `conversation=${conversation.id} matchedPatterns=${injectionCheck.matchedPatterns.length}`, component: "chat-security" });
    }

    const intentResult = detectIntent(sanitized);
    const entities = extractEntities(sanitized);
    const languageDetection = detectChunkLanguage(sanitized);
    // Defense in depth alongside the write-site normalization in
    // startOrResumeConversation above: a conversation created before that
    // fix (or by any other path that ever wrote a raw, unnormalized
    // language) could still have a bad value sitting in the database —
    // this guard keeps such a conversation from being permanently stuck
    // rather than just preventing new ones.
    const language = conversation.language && isSupportedLanguage(conversation.language) ? conversation.language : languageDetection.name;

    const priorTurns = await records.getRecentTurns(conversation.id);
    const context = buildContext({
      allTurns: priorTurns,
      topicSummary: conversation.topicSummary ?? "",
      currentIntent: intentResult.intent,
      currentEntities: entities,
      language,
    });

    const userMessage = await records.saveMessage({ conversationId: conversation.id, role: "USER", content: sanitized, intent: intentResult.intent, entities, language });

    const retrieval = await retrieveEvidence(databaseUrl, { installationId: params.installationId, intent: intentResult.intent, message: sanitized, language, entities, permissions, connectorRecords });
    const grounding = evaluateGrounding(retrieval.raw);
    const refusalMessage = buildRefusalMessage(intentResult.intent);

    const promptMessages = buildPromptMessages({ context, evidenceTexts: retrieval.evidenceTexts, businessName: params.businessName, currentMessage: sanitized });
    const provider = getLlmProvider();

    let assistantContent = "";
    let tokensIn = 0;
    let tokensOut = 0;
    let streamFailed = false;

    if (params.onDelta) {
      for await (const chunk of streamResponse({ provider, promptMessages, grounded: grounding.grounded, refusalMessage, evidenceTexts: retrieval.evidenceTexts })) {
        if (chunk.type === "delta") {
          params.onDelta(chunk.delta);
        } else if (chunk.type === "done") {
          assistantContent = chunk.result.content;
          tokensIn = chunk.result.tokensIn;
          tokensOut = chunk.result.tokensOut;
        } else if (chunk.type === "error") {
          streamFailed = true;
          assistantContent = "I'm having trouble generating a response right now — please try again in a moment, or reach out to our support team.";
          logEvent({ component: "chat-orchestrator", message: "LLM stream error", status: "error", error: chunk.error });
        }
      }
    } else {
      const generated = await generateResponse({ provider, promptMessages, grounded: grounding.grounded, refusalMessage, evidenceTexts: retrieval.evidenceTexts });
      assistantContent = generated.content;
      tokensIn = generated.tokensIn;
      tokensOut = generated.tokensOut;
    }

    const groundingAudit = grounding.grounded && !streamFailed ? auditResponseGrounding(assistantContent, retrieval.evidenceTexts) : { possiblyUngrounded: false, unmatchedFigures: [] };
    if (groundingAudit.possiblyUngrounded) {
      recordAuditEvent({ type: "chat_response_possibly_ungrounded", detail: `conversation=${conversation.id} figures=${groundingAudit.unmatchedFigures.join(", ")}`, component: "chat-security" });
    }
    if (!grounding.grounded) {
      recordAuditEvent({ type: "chat_grounding_refused", detail: `conversation=${conversation.id} reason="${grounding.reason}"`, component: "chat-security" });
    }

    const tookMs = Date.now() - startedAt;
    const assistantMessage = await records.saveMessage({
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: assistantContent,
      intent: intentResult.intent,
      language,
      sources: retrieval.sources,
      confidence: retrieval.answered ? retrieval.overallConfidence : null,
      tookMs,
      tokensIn,
      tokensOut,
    });

    const consecutiveUngroundedCount = grounding.grounded ? 0 : await records.getConsecutiveUngroundedCount(conversation.id);
    const escalationDecision = evaluateEscalation({ intent: intentResult.intent, grounded: grounding.grounded, consecutiveUngroundedCount, messageText: sanitized });

    let escalationTicketId: string | null = null;
    if (escalationDecision.shouldEscalate && escalationDecision.reason && escalationDecision.channel) {
      const ticket = await records.createEscalationTicket({
        conversationId: conversation.id,
        installationId: params.installationId,
        reason: escalationDecision.reason,
        channel: escalationDecision.channel,
        triggeredBy: "system",
        notes: escalationDecision.explanation,
      });
      escalationTicketId = ticket.id;
      await records.updateConversationStatus(conversation.id, "ESCALATED");
      recordAuditEvent({ type: "chat_escalation_triggered", detail: `conversation=${conversation.id} reason=${escalationDecision.reason} channel=${escalationDecision.channel}`, component: "chat-security" });
    }

    const memoryFact = summarizeTurnForMemory(intentResult.intent, entities);
    if (memoryFact) {
      const updatedSummary = updateTopicSummary(conversation.topicSummary ?? "", memoryFact);
      await records.updateConversationTopicSummary(conversation.id, updatedSummary);
    }

    await records.touchConversation(conversation.id);
    recordAuditEvent({ type: "chat_message_processed", detail: `conversation=${conversation.id} intent=${intentResult.intent} grounded=${grounding.grounded} tookMs=${tookMs}`, component: "chat-security" });

    return {
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      content: assistantContent,
      intent: intentResult.intent,
      language,
      sources: retrieval.sources,
      confidence: retrieval.answered ? retrieval.overallConfidence : null,
      suggestedQuestions: deriveSuggestedQuestions(intentResult.intent),
      quickActions: deriveQuickActions(intentResult.intent),
      escalated: escalationDecision.shouldEscalate,
      escalationTicketId,
      groundingAudit,
      tookMs,
    };
  } finally {
    await records.close();
    await permissions.close();
    await connectorRecords.close();
  }
}

// ── Feedback / regeneration / sharing ───────────────────────────────

export async function recordMessageFeedback(databaseUrl: string, messageId: string, feedback: "LIKE" | "DISLIKE" | "NONE"): Promise<void> {
  const records = new ChatRecordService(databaseUrl);
  try {
    await records.setMessageFeedback(messageId, feedback);
    recordAuditEvent({ type: "chat_feedback_recorded", detail: `message=${messageId} feedback=${feedback}`, component: "chat-security" });
  } finally {
    await records.close();
  }
}

export interface CreateShareLinkResult {
  shareToken: string;
  expiresAt: Date;
}

/** Generates (or rotates) a share token for a conversation — the "Share Conversation" feature. A prior token, if any, is silently replaced (the old link simply stops working), matching the product's general "least surprise" pattern of one live credential per resource rather than accumulating valid old ones. */
export async function createConversationShareLink(databaseUrl: string, conversationId: string): Promise<CreateShareLinkResult> {
  const records = new ChatRecordService(databaseUrl);
  try {
    const token = generateShareToken();
    const expiresAt = computeShareTokenExpiry();
    await records.setConversationShareToken(conversationId, token, expiresAt);
    return { shareToken: token, expiresAt };
  } finally {
    await records.close();
  }
}
