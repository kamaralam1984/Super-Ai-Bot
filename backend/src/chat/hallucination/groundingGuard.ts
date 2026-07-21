// Hallucination Prevention Engine. Two independent layers:
//
// 1. Retrieval-time (`evaluateGrounding`): Phase 3's own
//    `formatGroundedAnswer` already refuses to answer when nothing clears
//    a confidence floor (see knowledge/citation/citationFormatter.ts) —
//    this module turns that internal, technical refusal reason into a
//    polite, customer-facing message, intent-aware (a complaint gets
//    routed toward escalation language, not a generic "I don't know").
//
// 2. Output-time (`auditResponseGrounding`): even when retrieval succeeds,
//    an LLM can still fabricate a specific detail (most dangerously, a
//    price) that isn't actually in the retrieved context. This is a
//    best-effort, honestly-scoped second check on the *generated text*,
//    not a substitute for #1 — it currently checks monetary figures only
//    (the single highest-consequence fabrication category the spec calls
//    out by name: "never create fake prices") and is documented as such
//    rather than presented as a general-purpose fact-checker it isn't.

import type { CitationResult } from "../../knowledge/citation/citationFormatter";
import type { ChatIntent } from "../nlu/intentDetector";

export interface GroundingDecision {
  grounded: boolean;
  reason: string;
}

/** Whether the retrieval step produced enough grounded evidence to let the LLM answer at all. */
export function evaluateGrounding(searchResult: CitationResult): GroundingDecision {
  if (!searchResult.answered) {
    return { grounded: false, reason: searchResult.reason };
  }
  return { grounded: true, reason: `Grounded by ${searchResult.sources.length} source(s) at ${searchResult.overallConfidence.toFixed(2)} confidence.` };
}

const ESCALATION_LEANING_SUFFIX: Partial<Record<ChatIntent, string>> = {
  complaint: " I'd like to connect you with our support team so they can look into this properly — would that be alright?",
  human_request: " Let me connect you with a member of our team.",
  order_status: " I'd recommend contacting our support team directly with your order details so they can look this up for you.",
};

const DEFAULT_SUFFIX = " I don't want to guess, so I'd recommend reaching out to our support team for a definitive answer — or let me know if there's something else I can help with.";

/** A polite, never-guessing refusal — always indicates uncertainty rather than making an unsupported claim, and nudges toward human support when the intent suggests that's actually what's needed. */
export function buildRefusalMessage(intent: ChatIntent): string {
  const base = "I don't have verified information about that in our knowledge base right now.";
  return base + (ESCALATION_LEANING_SUFFIX[intent] ?? DEFAULT_SUFFIX);
}

export interface GroundingAudit {
  possiblyUngrounded: boolean;
  unmatchedFigures: string[];
}

const MONEY_PATTERN = /[$€£₹¥]\s?\d[\d,]*(?:\.\d{1,2})?/g;

function normalizeFigure(figure: string): string {
  return figure.replace(/\s/g, "");
}

/**
 * Best-effort post-hoc check: any monetary figure the model's response
 * states that doesn't appear anywhere in the retrieved source excerpts is
 * flagged as a candidate fabrication. Deliberately narrow in scope (prices
 * only, not a general claim-checker) and deliberately advisory (returns a
 * flag for the orchestrator to log/react to, does not itself block or
 * rewrite the response) — see this module's doc comment for why.
 */
export function auditResponseGrounding(responseText: string, sourceExcerpts: string[]): GroundingAudit {
  const responseFigures = new Set([...(responseText.match(MONEY_PATTERN) ?? [])].map(normalizeFigure));
  const sourceFigures = new Set([...(sourceExcerpts.join(" ").match(MONEY_PATTERN) ?? [])].map(normalizeFigure));

  const unmatchedFigures = [...responseFigures].filter((figure) => !sourceFigures.has(figure));
  return { possiblyUngrounded: unmatchedFigures.length > 0, unmatchedFigures };
}
