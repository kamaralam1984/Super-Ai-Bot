import { describe, it, expect } from "vitest";
import { deriveRecentTopics, isTopicSwitch, toLlmMessages, windowTurns, type ConversationTurn } from "./shortTermMemory";

function turn(role: "user" | "assistant", content: string, intent?: ConversationTurn["intent"]): ConversationTurn {
  return { role, content, intent, createdAt: new Date().toISOString() };
}

describe("windowTurns", () => {
  it("returns all turns when fewer than the window size", () => {
    const turns = [turn("user", "hi"), turn("assistant", "hello")];
    expect(windowTurns(turns, 12)).toEqual(turns);
  });

  it("keeps only the most recent N turns", () => {
    const turns = Array.from({ length: 20 }, (_, i) => turn("user", `msg ${i}`));
    const windowed = windowTurns(turns, 5);
    expect(windowed).toHaveLength(5);
    expect(windowed[0].content).toBe("msg 15");
    expect(windowed[4].content).toBe("msg 19");
  });
});

describe("deriveRecentTopics", () => {
  it("extracts distinct real-topic intents, most recent first", () => {
    const turns = [turn("user", "hi", "greeting"), turn("user", "price?", "pricing_inquiry"), turn("user", "what about shipping?", "policy_inquiry")];
    expect(deriveRecentTopics(turns)).toEqual(["policy_inquiry", "pricing_inquiry"]);
  });

  it("excludes greeting/small-talk/unknown/feedback noise", () => {
    const turns = [turn("user", "hi", "greeting"), turn("user", "thanks!", "feedback_positive"), turn("user", "bye", "goodbye")];
    expect(deriveRecentTopics(turns)).toEqual([]);
  });

  it("dedupes a topic mentioned more than once", () => {
    const turns = [turn("user", "price?", "pricing_inquiry"), turn("assistant", "..."), turn("user", "and the discount?", "pricing_inquiry")];
    expect(deriveRecentTopics(turns)).toEqual(["pricing_inquiry"]);
  });

  it("respects the limit", () => {
    const intents = ["pricing_inquiry", "policy_inquiry", "faq", "product_inquiry", "service_inquiry", "order_status"] as const;
    const turns = intents.map((intent) => turn("user", intent, intent));
    expect(deriveRecentTopics(turns, 3)).toHaveLength(3);
  });
});

describe("isTopicSwitch", () => {
  it("is true when the new intent differs from the last real-topic user turn", () => {
    const turns = [turn("user", "price?", "pricing_inquiry"), turn("assistant", "...")];
    expect(isTopicSwitch(turns, "policy_inquiry")).toBe(true);
  });

  it("is false when the new intent matches the last real-topic user turn", () => {
    const turns = [turn("user", "price?", "pricing_inquiry"), turn("assistant", "...")];
    expect(isTopicSwitch(turns, "pricing_inquiry")).toBe(false);
  });

  it("is false for a non-topic intent regardless of history", () => {
    const turns = [turn("user", "price?", "pricing_inquiry")];
    expect(isTopicSwitch(turns, "greeting")).toBe(false);
  });

  it("is false when there is no prior real-topic turn to compare against", () => {
    const turns = [turn("user", "hi", "greeting")];
    expect(isTopicSwitch(turns, "pricing_inquiry")).toBe(false);
  });

  it("looks past intervening greeting/small-talk turns to find the last real topic", () => {
    const turns = [turn("user", "price?", "pricing_inquiry"), turn("assistant", "..."), turn("user", "thanks", "feedback_positive")];
    expect(isTopicSwitch(turns, "policy_inquiry")).toBe(true);
    expect(isTopicSwitch(turns, "pricing_inquiry")).toBe(false);
  });
});

describe("toLlmMessages", () => {
  it("maps turns to role/content pairs, dropping intent metadata", () => {
    const turns = [turn("user", "hi", "greeting"), turn("assistant", "Hello! How can I help?")];
    expect(toLlmMessages(turns)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello! How can I help?" },
    ]);
  });
});
