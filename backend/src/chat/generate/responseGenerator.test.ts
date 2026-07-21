import { describe, it, expect, vi } from "vitest";
import { generateResponse, streamResponse } from "./responseGenerator";
import type { LlmProvider } from "../llm/llmProvider.interface";

function fakeProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    name: "fake",
    model: "fake-model",
    generate: vi.fn(async () => ({ content: "Widgets cost $49.", tokensIn: 10, tokensOut: 5, stopReason: "end_turn", model: "fake-model" })),
    streamGenerate: vi.fn(async function* () {
      yield { type: "delta" as const, delta: "Widgets " };
      yield { type: "delta" as const, delta: "cost $49." };
      yield { type: "done" as const, result: { content: "Widgets cost $49.", tokensIn: 10, tokensOut: 5, stopReason: "end_turn", model: "fake-model" } };
    }),
    ...overrides,
  };
}

describe("generateResponse", () => {
  it("calls the provider and returns its result when grounded", async () => {
    const provider = fakeProvider();
    const result = await generateResponse({ provider, promptMessages: [{ role: "user", content: "How much?" }], grounded: true, refusalMessage: "n/a", evidenceTexts: ["Widgets cost $49."] });
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(result.content).toBe("Widgets cost $49.");
    expect(result.wasRefusal).toBe(false);
    expect(result.groundingAudit.possiblyUngrounded).toBe(false);
  });

  it("never calls the provider when ungrounded — returns the refusal directly", async () => {
    const provider = fakeProvider();
    const result = await generateResponse({ provider, promptMessages: [], grounded: false, refusalMessage: "I don't know that.", evidenceTexts: [] });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(result).toEqual({ content: "I don't know that.", tokensIn: 0, tokensOut: 0, wasRefusal: true, groundingAudit: { possiblyUngrounded: false, unmatchedFigures: [] } });
  });

  it("flags a fabricated price via the grounding audit", async () => {
    const provider = fakeProvider({ generate: vi.fn(async () => ({ content: "It costs $999.", tokensIn: 1, tokensOut: 1, stopReason: null, model: "fake" })) });
    const result = await generateResponse({ provider, promptMessages: [], grounded: true, refusalMessage: "n/a", evidenceTexts: ["No pricing information available."] });
    expect(result.groundingAudit.possiblyUngrounded).toBe(true);
  });
});

describe("streamResponse", () => {
  it("streams delta chunks then done from the provider when grounded", async () => {
    const provider = fakeProvider();
    const chunks = [];
    for await (const chunk of streamResponse({ provider, promptMessages: [], grounded: true, refusalMessage: "n/a", evidenceTexts: [] })) chunks.push(chunk);
    expect(provider.streamGenerate).toHaveBeenCalledOnce();
    expect(chunks).toHaveLength(3);
    expect(chunks[2]).toEqual({ type: "done", result: { content: "Widgets cost $49.", tokensIn: 10, tokensOut: 5, stopReason: "end_turn", model: "fake-model" } });
  });

  it("emits the refusal as a single delta+done without calling the provider", async () => {
    const provider = fakeProvider();
    const chunks = [];
    for await (const chunk of streamResponse({ provider, promptMessages: [], grounded: false, refusalMessage: "I don't know.", evidenceTexts: [] })) chunks.push(chunk);
    expect(provider.streamGenerate).not.toHaveBeenCalled();
    expect(chunks).toEqual([{ type: "delta", delta: "I don't know." }, { type: "done", result: { content: "I don't know.", tokensIn: 0, tokensOut: 0, stopReason: "grounding_refusal", model: "grounding-guard" } }]);
  });
});
