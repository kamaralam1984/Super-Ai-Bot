// Escalation Engine — pure rule evaluation deciding whether a turn should
// hand off to a human, why, and through which channel. Checked in priority
// order (most safety/urgency-critical first) so a message that matches
// more than one trigger (e.g. an angry complaint that's also a billing
// dispute) still gets the most appropriate single reason and channel
// rather than an arbitrary one.

import type { ChatIntent } from "../nlu/intentDetector";

export type EscalationReason = "HUMAN_REQUESTED" | "LOW_CONFIDENCE" | "SENSITIVE_TOPIC" | "REPEATED_FAILURE" | "COMPLAINT" | "LEGAL" | "BILLING_DISPUTE" | "TECHNICAL_BEYOND_KNOWLEDGE";
export type EscalationChannel = "LIVE_AGENT" | "EMAIL" | "TICKET" | "CALLBACK";

export interface EscalationDecision {
  shouldEscalate: boolean;
  reason: EscalationReason | null;
  channel: EscalationChannel | null;
  explanation: string;
}

export interface EscalationEvaluationParams {
  intent: ChatIntent;
  /** Whether *this* turn's retrieval was grounded — see hallucination/groundingGuard.ts. */
  grounded: boolean;
  /** How many ungrounded turns occurred immediately before this one, in a row (0 if the last turn was grounded or this is the first turn). */
  consecutiveUngroundedCount: number;
  messageText: string;
}

/** Repeated "I don't know" answers in a row is a real, if soft, signal that the knowledge base genuinely can't help this visitor — not a permanent failure, but worth a human's attention. */
const REPEATED_FAILURE_THRESHOLD = 2;

const SENSITIVE_KEYWORDS = [/\bdata\s+breach\b/i, /\bhacked\b/i, /security\s+vulnerability/i, /\binjur(y|ed)\b/i, /\bemergency\b/i, /self[\s-]?harm/i, /\bsuicide\b/i, /medical\s+emergency/i, /allergic\s+reaction/i];

const LEGAL_KEYWORDS = [/\blawsuit\b/i, /\blawyer\b/i, /\battorney\b/i, /legal\s+action/i, /\bsue\s+(you|us)\b/i, /\bgdpr\b/i, /data\s+protection\s+officer/i, /\bsubpoena\b/i];

const BILLING_DISPUTE_KEYWORDS = [/charged\s+(twice|incorrectly)/i, /unauthorized\s+charge/i, /billing\s+dispute/i, /refund\s+my\s+money/i, /dispute\s+this\s+charge/i, /\bchargeback\b/i];

const TECHNICAL_INTENTS = new Set<ChatIntent>(["product_inquiry", "service_inquiry", "inventory_inquiry", "appointment_inquiry", "order_status"]);

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** Evaluates one turn's escalation triggers. Pure — no I/O; the caller (chatOrchestrator.service.ts) is responsible for actually opening an EscalationTicket and transitioning Conversation.status when `shouldEscalate` is true. */
export function evaluateEscalation(params: EscalationEvaluationParams): EscalationDecision {
  if (matchesAny(SENSITIVE_KEYWORDS, params.messageText)) {
    return { shouldEscalate: true, reason: "SENSITIVE_TOPIC", channel: "LIVE_AGENT", explanation: "The message contains language indicating a safety or security-sensitive situation." };
  }

  if (matchesAny(LEGAL_KEYWORDS, params.messageText)) {
    return { shouldEscalate: true, reason: "LEGAL", channel: "EMAIL", explanation: "The message contains legal-matter language — routed to email so there's a written record." };
  }

  if (matchesAny(BILLING_DISPUTE_KEYWORDS, params.messageText)) {
    return { shouldEscalate: true, reason: "BILLING_DISPUTE", channel: "TICKET", explanation: "The message describes a billing dispute." };
  }

  if (params.intent === "human_request") {
    return { shouldEscalate: true, reason: "HUMAN_REQUESTED", channel: "LIVE_AGENT", explanation: "The visitor explicitly asked to speak with a human." };
  }

  if (params.intent === "complaint") {
    return { shouldEscalate: true, reason: "COMPLAINT", channel: "TICKET", explanation: "The message was classified as a complaint." };
  }

  if (!params.grounded && params.consecutiveUngroundedCount + 1 >= REPEATED_FAILURE_THRESHOLD) {
    const reason: EscalationReason = TECHNICAL_INTENTS.has(params.intent) ? "TECHNICAL_BEYOND_KNOWLEDGE" : "REPEATED_FAILURE";
    return {
      shouldEscalate: true,
      reason,
      channel: "TICKET",
      explanation: `${params.consecutiveUngroundedCount + 1} consecutive questions could not be answered from the knowledge base.`,
    };
  }

  return { shouldEscalate: false, reason: null, channel: null, explanation: "No escalation trigger matched." };
}
