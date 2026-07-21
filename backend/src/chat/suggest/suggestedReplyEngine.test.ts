import { describe, it, expect } from "vitest";
import { deriveQuickActions, deriveSuggestedQuestions } from "./suggestedReplyEngine";

describe("deriveSuggestedQuestions", () => {
  it("returns intent-specific suggestions", () => {
    const questions = deriveSuggestedQuestions("pricing_inquiry");
    expect(questions).toContain("Do you offer a free trial?");
  });

  it("falls back to general business questions for an intent with no dedicated bank", () => {
    const questions = deriveSuggestedQuestions("unknown");
    expect(questions.length).toBeGreaterThan(0);
  });

  it("respects the limit", () => {
    expect(deriveSuggestedQuestions("product_inquiry", 1)).toHaveLength(1);
  });

  it("is deterministic", () => {
    expect(deriveSuggestedQuestions("faq")).toEqual(deriveSuggestedQuestions("faq"));
  });
});

describe("deriveQuickActions", () => {
  it("surfaces talk_to_human for a complaint", () => {
    expect(deriveQuickActions("complaint")).toContain("talk_to_human");
  });

  it("surfaces track_order for order_status", () => {
    expect(deriveQuickActions("order_status")).toContain("track_order");
  });

  it("falls back to a sane default for an intent with no dedicated mapping", () => {
    expect(deriveQuickActions("unknown").length).toBeGreaterThan(0);
  });
});
