// Suggested Reply Engine — canned, curated Suggested Questions and Quick
// Actions per intent, not LLM-generated. A separate LLM call just to
// propose follow-up questions would add latency/cost to every single turn
// for a feature that a well-curated static bank already serves well; the
// bank is deliberately small and business-generic (not tied to any one
// installation's specific catalog) so it works out of the box for every
// self-hosted install without needing its own training data.

import type { ChatIntent } from "../nlu/intentDetector";

export type QuickAction = "view_products" | "view_services" | "view_pricing" | "view_faqs" | "contact_support" | "talk_to_human" | "track_order";

const SUGGESTED_QUESTIONS_BY_INTENT: Partial<Record<ChatIntent, string[]>> = {
  greeting: ["What products do you offer?", "What services do you provide?", "How can I contact support?"],
  product_inquiry: ["What are the specifications?", "Is this in stock?", "How much does it cost?"],
  service_inquiry: ["What's included in this service?", "How long does it take?", "Can I book a consultation?"],
  pricing_inquiry: ["Are there any discounts available?", "What payment methods do you accept?", "Do you offer a free trial?"],
  policy_inquiry: ["What's your return policy?", "How long is the warranty?", "What's your shipping policy?"],
  faq: ["Do you have a support team I can contact?", "Where can I find more documentation?"],
  contact_inquiry: ["What are your office hours?", "Do you have multiple locations?"],
  order_status: ["Can I cancel my order?", "How do I track my shipment?"],
  appointment_inquiry: ["What times are available this week?", "How do I reschedule?"],
  inventory_inquiry: ["When will this be back in stock?", "Can you notify me when it's available?"],
};

const DEFAULT_SUGGESTED_QUESTIONS = ["What products do you offer?", "What services do you provide?", "What are your business hours?"];

/** Follow-up questions to surface as clickable suggestions after a reply — biased toward the current topic, falling back to general business questions for intents with no dedicated bank (small talk, unknown, feedback). */
export function deriveSuggestedQuestions(intent: ChatIntent, limit = 3): string[] {
  return (SUGGESTED_QUESTIONS_BY_INTENT[intent] ?? DEFAULT_SUGGESTED_QUESTIONS).slice(0, limit);
}

const QUICK_ACTIONS_BY_INTENT: Partial<Record<ChatIntent, QuickAction[]>> = {
  greeting: ["view_products", "view_services", "contact_support"],
  product_inquiry: ["view_pricing", "talk_to_human"],
  service_inquiry: ["view_pricing", "talk_to_human"],
  pricing_inquiry: ["view_products", "talk_to_human"],
  order_status: ["track_order", "contact_support"],
  complaint: ["talk_to_human", "contact_support"],
  human_request: ["talk_to_human"],
  policy_inquiry: ["view_faqs", "contact_support"],
};

const DEFAULT_QUICK_ACTIONS: QuickAction[] = ["view_faqs", "contact_support"];

/** Distinct from suggested *questions*: these are one-tap actions (buttons), not text a visitor would type — e.g. "Talk to a human" jumps straight to escalation rather than sending another chat turn. */
export function deriveQuickActions(intent: ChatIntent): QuickAction[] {
  return QUICK_ACTIONS_BY_INTENT[intent] ?? DEFAULT_QUICK_ACTIONS;
}
