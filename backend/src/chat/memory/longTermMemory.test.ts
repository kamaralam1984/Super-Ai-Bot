import { describe, it, expect } from "vitest";
import { summarizeTurnForMemory, updateTopicSummary } from "./longTermMemory";

describe("updateTopicSummary", () => {
  it("returns the new fact when there is no current summary", () => {
    expect(updateTopicSummary("", "Asked about pricing.")).toBe("Asked about pricing.");
  });

  it("appends a new fact to an existing summary", () => {
    expect(updateTopicSummary("Asked about pricing.", "Mentioned product \"Widget\".")).toBe('Asked about pricing. Mentioned product "Widget".');
  });

  it("ignores a blank new fact", () => {
    expect(updateTopicSummary("Asked about pricing.", "   ")).toBe("Asked about pricing.");
  });

  it("trims the oldest sentence once the bound is exceeded, keeping the newest content", () => {
    const oldFact = "A".repeat(700) + ".";
    const newFact = "B".repeat(700) + ".";
    const result = updateTopicSummary(oldFact, newFact);
    expect(result.length).toBeLessThanOrEqual(800);
    expect(result).toContain("B".repeat(50));
    expect(result).not.toContain("A".repeat(50));
  });

  it("never exceeds the max length even for a single fact longer than the bound", () => {
    const hugeFact = "C".repeat(2000);
    const result = updateTopicSummary("", hugeFact);
    expect(result.length).toBeLessThanOrEqual(800);
  });
});

describe("summarizeTurnForMemory", () => {
  it("returns a sentence for a real-topic intent", () => {
    expect(summarizeTurnForMemory("pricing_inquiry", [])).toBe("Asked about pricing inquiry.");
  });

  it("returns null for a greeting with no entities", () => {
    expect(summarizeTurnForMemory("greeting", [])).toBeNull();
  });

  it("includes mentioned product/service entities", () => {
    const result = summarizeTurnForMemory("product_inquiry", [{ type: "product_mention", value: "Widget Pro", raw: "Widget Pro" }]);
    expect(result).toContain("Asked about product inquiry.");
    expect(result).toContain('Mentioned product "Widget Pro".');
  });

  it("still returns a fact from entities alone when the intent isn't a real topic", () => {
    const result = summarizeTurnForMemory("greeting", [{ type: "service_mention", value: "Consulting", raw: "Consulting" }]);
    expect(result).toBe('Mentioned service "Consulting".');
  });

  it("ignores non-product/service entities (e.g. email, phone)", () => {
    expect(summarizeTurnForMemory("greeting", [{ type: "email", value: "a@b.com", raw: "a@b.com" }])).toBeNull();
  });
});
