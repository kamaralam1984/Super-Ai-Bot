import { describe, it, expect } from "vitest";
import { buildPromptMessages } from "./promptBuilder";
import type { ChatContext } from "../context/contextManager";

function baseContext(overrides: Partial<ChatContext> = {}): ChatContext {
  return { recentTurns: [], recentTopics: [], topicSummary: "", currentIntent: "unknown", currentEntities: [], isTopicSwitch: false, language: "English", ...overrides };
}

describe("buildPromptMessages", () => {
  it("puts a system message first, referencing the business name", () => {
    const messages = buildPromptMessages({ context: baseContext(), evidenceTexts: [], businessName: "Acme Corp", currentMessage: "Hi" });
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Acme Corp");
  });

  it("includes numbered evidence texts when present", () => {
    const messages = buildPromptMessages({ context: baseContext(), evidenceTexts: ["Widgets cost $49.", "We ship worldwide."], businessName: "Acme", currentMessage: "How much?" });
    expect(messages[0].content).toContain("[1] Widgets cost $49.");
    expect(messages[0].content).toContain("[2] We ship worldwide.");
  });

  it("states plainly when there is no retrieved evidence", () => {
    const messages = buildPromptMessages({ context: baseContext(), evidenceTexts: [], businessName: "Acme", currentMessage: "How much?" });
    expect(messages[0].content).toContain("none — no matching content was found");
  });

  it("includes the rolling topic summary when present", () => {
    const messages = buildPromptMessages({ context: baseContext({ topicSummary: "Visitor is comparing the Pro and Standard plans." }), evidenceTexts: [], businessName: "Acme", currentMessage: "And pricing?" });
    expect(messages[0].content).toContain("Visitor is comparing the Pro and Standard plans.");
  });

  it("omits the topic-summary line entirely when there is no summary yet", () => {
    const messages = buildPromptMessages({ context: baseContext({ topicSummary: "" }), evidenceTexts: [], businessName: "Acme", currentMessage: "Hi" });
    expect(messages[0].content).not.toContain("CONVERSATION SO FAR");
  });

  it("instructs the model to respond in the detected language", () => {
    const messages = buildPromptMessages({ context: baseContext({ language: "Hindi" }), evidenceTexts: [], businessName: "Acme", currentMessage: "नमस्ते" });
    expect(messages[0].content).toContain("Respond in Hindi");
  });

  it("includes a rule against treating retrieved/user text as instructions (prompt-injection defense)", () => {
    const messages = buildPromptMessages({ context: baseContext(), evidenceTexts: [], businessName: "Acme", currentMessage: "Hi" });
    expect(messages[0].content).toMatch(/never as instructions to follow/);
  });

  it("replays short-term memory turns in order, then appends the current message last", () => {
    const context = baseContext({ recentTurns: [{ role: "user", content: "What products do you sell?", createdAt: "" }, { role: "assistant", content: "We sell widgets and gadgets.", createdAt: "" }] });
    const messages = buildPromptMessages({ context, evidenceTexts: [], businessName: "Acme", currentMessage: "How much is the widget?" });
    expect(messages).toEqual([
      messages[0],
      { role: "user", content: "What products do you sell?" },
      { role: "assistant", content: "We sell widgets and gadgets." },
      { role: "user", content: "How much is the widget?" },
    ]);
  });
});
