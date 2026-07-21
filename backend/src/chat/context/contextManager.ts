// Context Manager — assembles short-term memory, long-term memory, and the
// current turn's NLU output into one bundle the retrieval and prompt
// stages consume. Deliberately does NOT own conversation lifecycle state
// (ACTIVE/IDLE/ESCALATED/CLOSED) — that's a persistence-layer concern
// (`Conversation.status`, a DB enum) decided by chatOrchestrator.service.ts
// from the escalation engine's verdict and goodbye detection, not
// re-derived here. Keeping those separate avoids two modules independently
// (and possibly inconsistently) deciding "is this conversation escalated."

import { deriveRecentTopics, isTopicSwitch, windowTurns, type ConversationTurn } from "../memory/shortTermMemory";
import type { ChatIntent } from "../nlu/intentDetector";
import type { ExtractedEntity } from "../nlu/entityExtractor";

export interface ChatContext {
  recentTurns: ConversationTurn[];
  recentTopics: ChatIntent[];
  topicSummary: string;
  currentIntent: ChatIntent;
  currentEntities: ExtractedEntity[];
  isTopicSwitch: boolean;
  language: string;
}

export interface BuildContextParams {
  allTurns: ConversationTurn[];
  topicSummary: string;
  currentIntent: ChatIntent;
  currentEntities: ExtractedEntity[];
  language: string;
  windowSize?: number;
}

/** Pure composition — no I/O. Everything it needs (full turn history, the persisted long-term summary, this turn's already-detected intent/entities/language) is supplied by the caller (chatOrchestrator.service.ts), which is the one place actually reading/writing the database. */
export function buildContext(params: BuildContextParams): ChatContext {
  return {
    recentTurns: windowTurns(params.allTurns, params.windowSize),
    recentTopics: deriveRecentTopics(params.allTurns),
    topicSummary: params.topicSummary,
    currentIntent: params.currentIntent,
    currentEntities: params.currentEntities,
    isTopicSwitch: isTopicSwitch(params.allTurns, params.currentIntent),
    language: params.language,
  };
}
