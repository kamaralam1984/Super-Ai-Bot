import { describe, it, expect } from "vitest";
import { auditResponseGrounding, buildRefusalMessage, evaluateGrounding } from "./groundingGuard";
import type { CitationResult } from "../../knowledge/citation/citationFormatter";

describe("evaluateGrounding", () => {
  it("is grounded when the search answered", () => {
    const result: CitationResult = { answered: true, sources: [{ chunkId: "c1", sourceUrl: "https://x", title: null, category: null, excerpt: "...", confidenceScore: 0.9, relevanceScore: 0.8 }], overallConfidence: 0.72 };
    const decision = evaluateGrounding(result);
    expect(decision.grounded).toBe(true);
    expect(decision.reason).toContain("1 source");
  });

  it("is not grounded when the search refused, and surfaces the refusal reason", () => {
    const result: CitationResult = { answered: false, reason: "No matching content was found in the knowledge base for this query." };
    const decision = evaluateGrounding(result);
    expect(decision.grounded).toBe(false);
    expect(decision.reason).toBe(result.reason);
  });
});

describe("buildRefusalMessage", () => {
  it("never claims to know the answer", () => {
    expect(buildRefusalMessage("product_inquiry")).toMatch(/don't have verified information/);
  });

  it("leans toward escalation language for a complaint", () => {
    expect(buildRefusalMessage("complaint")).toMatch(/connect you with our support team/);
  });

  it("leans toward escalation language for a human request", () => {
    expect(buildRefusalMessage("human_request")).toMatch(/connect you with a member of our team/);
  });

  it("uses the default suffix for an ordinary unanswerable question", () => {
    expect(buildRefusalMessage("faq")).toMatch(/reaching out to our support team for a definitive answer/);
  });
});

describe("auditResponseGrounding", () => {
  it("flags a price mentioned in the response that isn't in any source", () => {
    const audit = auditResponseGrounding("The Widget Pro costs $999.99.", ["The Widget Pro is our flagship product with a sleek design."]);
    expect(audit.possiblyUngrounded).toBe(true);
    expect(audit.unmatchedFigures).toEqual(["$999.99"]);
  });

  it("does not flag a price that does appear in the sources", () => {
    const audit = auditResponseGrounding("The Widget Pro costs $49.99.", ["The Widget Pro is priced at $49.99."]);
    expect(audit.possiblyUngrounded).toBe(false);
    expect(audit.unmatchedFigures).toEqual([]);
  });

  it("does not flag anything when the response mentions no figures", () => {
    const audit = auditResponseGrounding("The Widget Pro is a great choice.", ["Some unrelated source text."]);
    expect(audit.possiblyUngrounded).toBe(false);
  });

  it("ignores whitespace differences between a currency symbol and the amount", () => {
    const audit = auditResponseGrounding("It costs $ 49.99.", ["Priced at $49.99 exactly."]);
    expect(audit.possiblyUngrounded).toBe(false);
  });
});
