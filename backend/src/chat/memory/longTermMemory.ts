// Long-Term Memory — a single rolling summary persisted on
// `Conversation.topicSummary`, rewritten a little each turn rather than
// stored as a growing history of its own. Deliberately not LLM-maintained
// (no extra model round-trip just to keep a summary current): a bounded,
// deterministic append-and-trim strategy is enough to answer "what has
// this visitor told us / asked about before" across a long conversation or
// a returning visitor's next session, without unbounded growth eating into
// every future prompt's token budget.

import type { ChatIntent } from "../nlu/intentDetector";
import type { ExtractedEntity } from "../nlu/entityExtractor";

const MAX_SUMMARY_LENGTH = 800; // characters

const NON_TOPIC_INTENTS = new Set<ChatIntent>(["unknown", "greeting", "goodbye", "small_talk", "feedback_positive", "feedback_negative"]);

/**
 * Merges a new fact/sentence into the rolling summary, trimming the
 * *oldest* sentence(s) once the bound is exceeded so the most recent
 * context always survives — a conversation's early "hello, what do you
 * sell" is far less worth keeping than "visitor is deciding between the
 * Pro and Standard plans" from five turns ago.
 */
export function updateTopicSummary(currentSummary: string, newFact: string): string {
  const trimmedFact = newFact.trim();
  if (!trimmedFact) return currentSummary;

  const combined = currentSummary ? `${currentSummary} ${trimmedFact}` : trimmedFact;
  if (combined.length <= MAX_SUMMARY_LENGTH) return combined;

  const sentences = combined.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
  let result = combined;
  while (result.length > MAX_SUMMARY_LENGTH && sentences.length > 1) {
    sentences.shift();
    result = sentences.join(" ");
  }
  return result.length > MAX_SUMMARY_LENGTH ? result.slice(result.length - MAX_SUMMARY_LENGTH) : result;
}

/**
 * Turns one user turn's detected intent + entities into a short factual
 * sentence worth remembering long-term, or null if there's nothing worth
 * keeping (a greeting, small talk, or a message with no real topic/entity
 * carries no long-term-memory-worthy signal).
 */
export function summarizeTurnForMemory(intent: ChatIntent, entities: ExtractedEntity[]): string | null {
  const namedEntities = entities.filter((e) => e.type === "product_mention" || e.type === "service_mention");
  const parts: string[] = [];

  if (!NON_TOPIC_INTENTS.has(intent)) {
    parts.push(`Asked about ${intent.replace(/_/g, " ")}.`);
  }
  for (const entity of namedEntities) {
    parts.push(`Mentioned ${entity.type === "product_mention" ? "product" : "service"} "${entity.value}".`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}
