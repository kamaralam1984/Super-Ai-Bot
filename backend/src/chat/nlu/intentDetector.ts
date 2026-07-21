// Intent Detection — a deterministic, testable keyword/pattern classifier,
// not an LLM call. Two reasons: (1) escalation triggers and RAG
// tool-routing need a fast, reliable signal *before* an LLM call is even
// made (an LLM call that will itself be grounded by what this module
// decides to retrieve); (2) matching this codebase's established pattern
// (Phase 4's tech detection, Phase 6's policy classification) of
// heuristic classifiers with confidence scores over LLM-in-the-loop
// classification, for speed, cost, and testability without mocking a
// model. The LLM is still the one that writes the final reply — this only
// decides what to retrieve and whether to escalate.

export type ChatIntent =
  | "greeting"
  | "goodbye"
  | "product_inquiry"
  | "service_inquiry"
  | "pricing_inquiry"
  | "order_status"
  | "appointment_inquiry"
  | "inventory_inquiry"
  | "faq"
  | "policy_inquiry"
  | "contact_inquiry"
  | "complaint"
  | "human_request"
  | "feedback_positive"
  | "feedback_negative"
  | "small_talk"
  | "unknown";

export interface IntentMatch {
  intent: ChatIntent;
  confidence: number; // 0-1, matched-keyword density within a small saturation window
  matchedKeywords: string[];
}

export interface IntentDetectionResult extends IntentMatch {
  /** Every intent that scored above the noise floor, most confident first — a message can plausibly carry more than one (e.g. "I want a refund and to speak to someone" is both policy_inquiry and human_request). */
  candidates: IntentMatch[];
}

const INTENT_KEYWORDS: Record<Exclude<ChatIntent, "unknown">, string[]> = {
  greeting: ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "namaste", "salaam", "yo"],
  goodbye: ["bye", "goodbye", "see you", "talk later", "that's all", "thats all", "no more questions", "thank you bye"],
  product_inquiry: ["product", "item", "buy", "purchase", "specs", "specification", "available", "model", "catalog", "catalogue", "features of"],
  service_inquiry: ["service", "services", "offer", "provide", "consultation", "package", "plan"],
  pricing_inquiry: ["price", "pricing", "cost", "how much", "quote", "discount", "fee", "charges", "rate"],
  order_status: ["order status", "my order", "track order", "tracking", "shipment", "delivery status", "where is my order", "order number"],
  appointment_inquiry: ["appointment", "book a slot", "schedule", "reschedule", "booking", "available slot", "meeting time"],
  inventory_inquiry: ["in stock", "stock", "availability", "out of stock", "how many left", "inventory"],
  faq: ["faq", "frequently asked", "how do i", "how to", "what is", "can i", "do you"],
  policy_inquiry: ["policy", "refund", "return", "cancellation", "cancel", "warranty", "terms", "privacy", "shipping policy", "exchange"],
  contact_inquiry: ["contact", "phone number", "email address", "office hours", "location", "address", "opening hours", "where are you located"],
  complaint: ["complaint", "not working", "broken", "terrible", "worst", "unhappy", "disappointed", "unacceptable", "poor service", "angry"],
  human_request: ["human", "agent", "real person", "representative", "talk to someone", "speak to someone", "customer support", "live chat with", "connect me"],
  feedback_positive: ["thanks", "thank you", "great", "awesome", "helpful", "perfect", "love it", "amazing", "excellent"],
  feedback_negative: ["not helpful", "useless", "wrong answer", "that's wrong", "doesn't help", "not what i asked"],
  small_talk: ["how are you", "who are you", "what can you do", "are you a bot", "are you human", "your name"],
};

const MATCH_SATURATION = 3; // 3+ matched keywords for one intent already means "very confident" — more matches shouldn't push confidence higher
const MIN_CONFIDENCE = 0.3; // a single matched keyword (1/3) already counts as a real signal for a typically-short chat message

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary matching, not plain substring `includes()` — a naive
// substring check on a short keyword like "yo" or "hi" false-positives
// inside completely unrelated words ("yo" inside "you"/"your", "hi" inside
// "this"/"history"/"which"). `\b` anchors each keyword (and each multi-word
// phrase's start/end) to real word boundaries, verified by a real bug this
// module's own test suite caught: "Can you track my order?" was
// misdetected as a greeting purely because "yo" is a substring of "you".
const INTENT_KEYWORD_PATTERNS: Record<Exclude<ChatIntent, "unknown">, Array<{ keyword: string; pattern: RegExp }>> = Object.fromEntries(
  (Object.keys(INTENT_KEYWORDS) as Array<Exclude<ChatIntent, "unknown">>).map((intent) => [
    intent,
    INTENT_KEYWORDS[intent].map((keyword) => ({ keyword, pattern: new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i") })),
  ])
) as Record<Exclude<ChatIntent, "unknown">, Array<{ keyword: string; pattern: RegExp }>>;

function scoreIntent(text: string, keywordPatterns: Array<{ keyword: string; pattern: RegExp }>): { score: number; matched: string[] } {
  const matched = keywordPatterns.filter(({ pattern }) => pattern.test(text)).map(({ keyword }) => keyword);
  return { score: Math.min(matched.length / MATCH_SATURATION, 1), matched };
}

/** Detects the most likely intent(s) behind one message. Pure and deterministic — same input always yields the same output, no I/O. */
export function detectIntent(text: string): IntentDetectionResult {
  const trimmed = text.trim();

  const candidates: IntentMatch[] = (Object.keys(INTENT_KEYWORDS) as Array<Exclude<ChatIntent, "unknown">>)
    .map((intent) => {
      const { score, matched } = scoreIntent(trimmed, INTENT_KEYWORD_PATTERNS[intent]);
      return { intent, confidence: score, matchedKeywords: matched };
    })
    .filter((c) => c.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);

  if (candidates.length === 0) {
    const unknown: IntentMatch = { intent: "unknown", confidence: 0, matchedKeywords: [] };
    return { ...unknown, candidates: [unknown] };
  }

  return { ...candidates[0], candidates };
}

/** True if any candidate intent is one that should be considered for immediate escalation, independent of confidence in a *specific* other intent — a complaint mentioned alongside a product question is still a complaint. */
export function hasEscalationIntent(result: IntentDetectionResult): boolean {
  return result.candidates.some((c) => c.intent === "human_request" || c.intent === "complaint");
}
