import { describe, it, expect } from "vitest";
import { buildContext } from "./contextManager";
import type { ConversationTurn } from "../memory/shortTermMemory";

function turn(role: "user" | "assistant", content: string, intent?: ConversationTurn["intent"]): ConversationTurn {
  return { role, content, intent, createdAt: new Date().toISOString() };
}

describe("buildContext", () => {
  it("composes windowed turns, recent topics, and topic-switch detection", () => {
    const allTurns = [turn("user", "What's the price?", "pricing_inquiry"), turn("assistant", "It's $49.")];
    const context = buildContext({
      allTurns,
      topicSummary: "Visitor asked about pricing.",
      currentIntent: "policy_inquiry",
      currentEntities: [],
      language: "English",
    });

    expect(context.recentTurns).toEqual(allTurns);
    expect(context.recentTopics).toEqual(["pricing_inquiry"]);
    expect(context.topicSummary).toBe("Visitor asked about pricing.");
    expect(context.currentIntent).toBe("policy_inquiry");
    expect(context.isTopicSwitch).toBe(true);
    expect(context.language).toBe("English");
  });

  it("does not flag a topic switch when the current intent matches the last real topic", () => {
    const allTurns = [turn("user", "What's the price?", "pricing_inquiry")];
    const context = buildContext({ allTurns, topicSummary: "", currentIntent: "pricing_inquiry", currentEntities: [], language: "English" });
    expect(context.isTopicSwitch).toBe(false);
  });

  it("respects a custom window size", () => {
    const allTurns = Array.from({ length: 20 }, (_, i) => turn("user", `msg ${i}`));
    const context = buildContext({ allTurns, topicSummary: "", currentIntent: "unknown", currentEntities: [], language: "English", windowSize: 4 });
    expect(context.recentTurns).toHaveLength(4);
  });

  it("carries current entities through unchanged", () => {
    const entities = [{ type: "email" as const, value: "a@b.com", raw: "a@b.com" }];
    const context = buildContext({ allTurns: [], topicSummary: "", currentIntent: "contact_inquiry", currentEntities: entities, language: "English" });
    expect(context.currentEntities).toBe(entities);
  });
});
