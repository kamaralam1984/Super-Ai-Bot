import { describe, it, expect } from "vitest";
import { detectIntent, hasEscalationIntent } from "./intentDetector";

describe("detectIntent", () => {
  it("detects a greeting", () => {
    expect(detectIntent("Hi there!").intent).toBe("greeting");
  });

  it("detects a pricing inquiry", () => {
    expect(detectIntent("How much does this cost?").intent).toBe("pricing_inquiry");
  });

  it("detects an order status request", () => {
    expect(detectIntent("Can you track my order for me?").intent).toBe("order_status");
  });

  it("detects a human-agent request", () => {
    const result = detectIntent("I want to talk to a real person please");
    expect(result.intent).toBe("human_request");
  });

  it("detects a complaint", () => {
    expect(detectIntent("This is terrible, my item arrived broken").intent).toBe("complaint");
  });

  it("detects a policy inquiry", () => {
    expect(detectIntent("What is your refund policy?").intent).toBe("policy_inquiry");
  });

  it("returns unknown for text with no keyword signal", () => {
    const result = detectIntent("xyz qwerty asdf");
    expect(result.intent).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(detectIntent("HELLO THERE").intent).toBe("greeting");
  });

  it("saturates confidence at 1 rather than growing unboundedly with more matches", () => {
    const result = detectIntent("price cost how much pricing quote discount fee charges rate");
    expect(result.confidence).toBe(1);
  });

  it("surfaces multiple plausible candidates when a message carries more than one intent", () => {
    const result = detectIntent("I want a refund and I want to talk to a real person");
    const intents = result.candidates.map((c) => c.intent);
    expect(intents).toContain("policy_inquiry");
    expect(intents).toContain("human_request");
  });

  it("is deterministic — same input always yields the same output", () => {
    const text = "What are your office hours?";
    expect(detectIntent(text)).toEqual(detectIntent(text));
  });
});

describe("hasEscalationIntent", () => {
  it("is true when human_request is among the candidates", () => {
    expect(hasEscalationIntent(detectIntent("connect me to an agent"))).toBe(true);
  });

  it("is true when complaint is among the candidates", () => {
    expect(hasEscalationIntent(detectIntent("this is unacceptable, terrible service"))).toBe(true);
  });

  it("is false for an ordinary product inquiry", () => {
    expect(hasEscalationIntent(detectIntent("Do you have this product in blue?"))).toBe(false);
  });
});
