// Short-Term Memory — the sliding window of recent turns replayed into
// every LLM prompt, plus topic-switch detection. Deliberately bounded: the
// full conversation history always exists in the database (Message is the
// permanent record — see chatRecord.service.ts), but only the most recent
// window is ever replayed into a prompt, so prompt size (and LLM cost/
// latency) doesn't grow unboundedly with a long-running conversation.

import type { ChatIntent } from "../nlu/intentDetector";
import type { LlmMessage } from "../llm/llmProvider.interface";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  intent?: ChatIntent | null;
  createdAt: string; // ISO timestamp
}

const DEFAULT_WINDOW_SIZE = 12; // ~6 user/assistant exchanges

const NON_TOPIC_INTENTS = new Set<ChatIntent>(["unknown", "greeting", "goodbye", "small_talk", "feedback_positive", "feedback_negative"]);

/** The most recent `windowSize` turns, oldest-first within the window — what actually gets replayed into an LLM prompt. */
export function windowTurns(turns: ConversationTurn[], windowSize: number = DEFAULT_WINDOW_SIZE): ConversationTurn[] {
  return turns.slice(-windowSize);
}

/** Distinct "real" topics (intents, excluding greeting/small-talk/unknown/feedback noise) mentioned across a set of turns, most-recent-first and deduped — the signal suggestedReplyEngine and analytics use for "what has this visitor actually been asking about." */
export function deriveRecentTopics(turns: ConversationTurn[], limit = 5): ChatIntent[] {
  const seen = new Set<ChatIntent>();
  const topics: ChatIntent[] = [];
  for (let i = turns.length - 1; i >= 0 && topics.length < limit; i--) {
    const intent = turns[i].intent;
    if (intent && !NON_TOPIC_INTENTS.has(intent) && !seen.has(intent)) {
      seen.add(intent);
      topics.push(intent);
    }
  }
  return topics;
}

/** True when the newly detected intent is a real topic that differs from the most recent real-topic user turn — e.g. asking about Pricing right after a Shipping-policy exchange. Greeting/small-talk/feedback turns are ignored on both sides so they don't register as false topic switches. */
export function isTopicSwitch(turns: ConversationTurn[], newIntent: ChatIntent): boolean {
  if (NON_TOPIC_INTENTS.has(newIntent)) return false;
  const lastRealUserTopic = [...turns].reverse().find((t) => t.role === "user" && t.intent && !NON_TOPIC_INTENTS.has(t.intent));
  if (!lastRealUserTopic?.intent) return false;
  return lastRealUserTopic.intent !== newIntent;
}

/** Maps conversation turns to the provider-agnostic LLM message shape — the only place short-term memory becomes prompt content. */
export function toLlmMessages(turns: ConversationTurn[]): LlmMessage[] {
  return turns.map((t) => ({ role: t.role, content: t.content }));
}
