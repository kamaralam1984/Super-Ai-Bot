import { describe, it, expect } from "vitest";
import { evaluateEscalation } from "./escalationEngine";

const BASE = { intent: "faq" as const, grounded: true, consecutiveUngroundedCount: 0, messageText: "What are your hours?" };

describe("evaluateEscalation", () => {
  it("does not escalate an ordinary grounded question", () => {
    expect(evaluateEscalation(BASE).shouldEscalate).toBe(false);
  });

  it("escalates on an explicit human request", () => {
    const decision = evaluateEscalation({ ...BASE, intent: "human_request", messageText: "Can I talk to a human?" });
    expect(decision).toMatchObject({ shouldEscalate: true, reason: "HUMAN_REQUESTED", channel: "LIVE_AGENT" });
  });

  it("escalates on a complaint", () => {
    const decision = evaluateEscalation({ ...BASE, intent: "complaint", messageText: "This is terrible service" });
    expect(decision).toMatchObject({ shouldEscalate: true, reason: "COMPLAINT", channel: "TICKET" });
  });

  it("escalates on sensitive/safety language, taking priority over a milder intent", () => {
    const decision = evaluateEscalation({ ...BASE, intent: "faq", messageText: "I was injured using your product, this is an emergency" });
    expect(decision).toMatchObject({ shouldEscalate: true, reason: "SENSITIVE_TOPIC", channel: "LIVE_AGENT" });
  });

  it("escalates on legal language, routed to email", () => {
    const decision = evaluateEscalation({ ...BASE, messageText: "I'm going to talk to my lawyer about this" });
    expect(decision).toMatchObject({ shouldEscalate: true, reason: "LEGAL", channel: "EMAIL" });
  });

  it("escalates on a billing dispute", () => {
    const decision = evaluateEscalation({ ...BASE, messageText: "I was charged twice for this order" });
    expect(decision).toMatchObject({ shouldEscalate: true, reason: "BILLING_DISPUTE", channel: "TICKET" });
  });

  it("does not escalate on a single ungrounded answer", () => {
    const decision = evaluateEscalation({ ...BASE, grounded: false, consecutiveUngroundedCount: 0 });
    expect(decision.shouldEscalate).toBe(false);
  });

  it("escalates as REPEATED_FAILURE after enough consecutive ungrounded answers on a non-technical intent", () => {
    const decision = evaluateEscalation({ ...BASE, intent: "faq", grounded: false, consecutiveUngroundedCount: 1 });
    expect(decision).toMatchObject({ shouldEscalate: true, reason: "REPEATED_FAILURE", channel: "TICKET" });
  });

  it("escalates as TECHNICAL_BEYOND_KNOWLEDGE after enough consecutive ungrounded answers on a technical intent", () => {
    const decision = evaluateEscalation({ ...BASE, intent: "product_inquiry", grounded: false, consecutiveUngroundedCount: 1 });
    expect(decision).toMatchObject({ shouldEscalate: true, reason: "TECHNICAL_BEYOND_KNOWLEDGE", channel: "TICKET" });
  });

  it("prioritizes sensitive-topic detection over a matching complaint intent", () => {
    const decision = evaluateEscalation({ ...BASE, intent: "complaint", messageText: "This is a medical emergency, I had an allergic reaction" });
    expect(decision.reason).toBe("SENSITIVE_TOPIC");
  });
});
