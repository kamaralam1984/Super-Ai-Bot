import { describe, it, expect } from "vitest";
import { computeFaqConfidence, planFaqMerges, computeSimilarAndRelatedQuestions } from "./faqLearning";
import type { FaqRecord } from "./faqLearning";

describe("computeFaqConfidence", () => {
  it("scores a complete, structured-data-sourced, well-formed FAQ higher than a sparse heuristic one", () => {
    const strong = computeFaqConfidence({ question: "What is your return policy?", answer: "You can return any item within 30 days of purchase for a full refund, no questions asked.", source: "structured_data" });
    const weak = computeFaqConfidence({ question: "returns", answer: "yes", source: "heuristic" });
    expect(strong).toBeGreaterThan(weak);
  });

  it("rewards a clear question (ends in ? and starts with a question word)", () => {
    const clear = computeFaqConfidence({ question: "How do I reset my password?", answer: "Click forgot password on the login page and follow the emailed link.", source: "heuristic" });
    const unclear = computeFaqConfidence({ question: "password reset", answer: "Click forgot password on the login page and follow the emailed link.", source: "heuristic" });
    expect(clear).toBeGreaterThan(unclear);
  });

  it("rewards corroboration from merged duplicates", () => {
    const faq = { question: "What are your hours?", answer: "We are open 9am-5pm Monday through Friday.", source: "heuristic" };
    const corroborated = computeFaqConfidence(faq, 3);
    const solo = computeFaqConfidence(faq, 0);
    expect(corroborated).toBeGreaterThan(solo);
  });

  it("stays within [0, 1]", () => {
    const score = computeFaqConfidence({ question: "What is your return policy for all items purchased online or in-store?", answer: "A".repeat(500), source: "structured_data" }, 5);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("planFaqMerges", () => {
  function faq(overrides: Partial<FaqRecord>): FaqRecord {
    return { id: "id", question: "q", answer: "a", source: "heuristic", isDuplicate: false, duplicateOfFaqId: null, embedding: [], ...overrides };
  }

  it("returns no plans when there are no duplicate clusters", () => {
    const faqs = [faq({ id: "1" }), faq({ id: "2" })];
    expect(planFaqMerges(faqs)).toEqual([]);
  });

  it("groups a duplicate cluster and picks the most complete answer as canonical", () => {
    const faqs = [
      faq({ id: "1", question: "What are your hours?", answer: "9-5", source: "heuristic" }),
      faq({ id: "2", question: "When are you open?", answer: "We're open 9am to 5pm, Monday through Friday, excluding public holidays.", source: "heuristic", isDuplicate: true, duplicateOfFaqId: "1" }),
      faq({ id: "3", question: "Hours?", answer: "9-5 weekdays", source: "heuristic", isDuplicate: true, duplicateOfFaqId: "1" }),
    ];
    const plans = planFaqMerges(faqs);
    expect(plans).toHaveLength(1);
    expect(plans[0].canonicalId).toBe("2"); // longest, most complete answer wins over the original Phase-3-picked "1"
    expect(plans[0].mergedFaqIds.sort()).toEqual(["1", "3"]);
  });

  it("prefers structured_data source over answer length when choosing canonical", () => {
    const faqs = [
      faq({ id: "1", answer: "Short but structured answer.", source: "structured_data" }),
      faq({ id: "2", answer: "A much, much longer heuristic answer that goes on and on with lots of detail.", source: "heuristic", isDuplicate: true, duplicateOfFaqId: "1" }),
    ];
    const plans = planFaqMerges(faqs);
    expect(plans[0].canonicalId).toBe("1");
  });

  it("handles multiple independent clusters", () => {
    const faqs = [
      faq({ id: "1", answer: "aaaa" }),
      faq({ id: "2", answer: "aaaaaaaa", isDuplicate: true, duplicateOfFaqId: "1" }),
      faq({ id: "3", answer: "bbbb" }),
      faq({ id: "4", answer: "bbbbbbbb", isDuplicate: true, duplicateOfFaqId: "3" }),
    ];
    const plans = planFaqMerges(faqs);
    expect(plans).toHaveLength(2);
  });
});

// cosineSimilarity (embed/embeddings.ts) is a raw dot product, correct
// only for already-unit-normalized vectors (real embeddings are generated
// with normalize:true) — fixtures below are genuine unit vectors
// (embedding = [cosθ, sinθ, 0] relative to the target's [1,0,0]) so the
// threshold tests exercise real cosine values, not an accidental
// non-normalized dot-product magnitude that happens to land in range.
describe("computeSimilarAndRelatedQuestions", () => {
  const target: FaqRecord = { id: "t", question: "What is your refund policy?", answer: "...", source: "heuristic", isDuplicate: false, duplicateOfFaqId: null, embedding: [1, 0, 0] };

  it("classifies a near-identical question as similar, not related", () => {
    const paraphrase: FaqRecord = { id: "p", question: "What's the refund policy?", answer: "...", source: "heuristic", isDuplicate: false, duplicateOfFaqId: null, embedding: [0.95, 0.3122, 0] }; // cosine 0.95
    const result = computeSimilarAndRelatedQuestions(target, [paraphrase]);
    expect(result.similarQuestions.map((r) => r.id)).toEqual(["p"]);
    expect(result.relatedQuestions).toHaveLength(0);
  });

  it("classifies a topically related but distinct question as related, not similar", () => {
    const related: FaqRecord = { id: "r", question: "How long do refunds take to process?", answer: "...", source: "heuristic", isDuplicate: false, duplicateOfFaqId: null, embedding: [0.68, 0.7332, 0] }; // cosine 0.68
    const result = computeSimilarAndRelatedQuestions(target, [related]);
    expect(result.relatedQuestions.map((r) => r.id)).toEqual(["r"]);
    expect(result.similarQuestions).toHaveLength(0);
  });

  it("excludes a completely unrelated question from both tiers", () => {
    const unrelated: FaqRecord = { id: "u", question: "What are your business hours?", answer: "...", source: "heuristic", isDuplicate: false, duplicateOfFaqId: null, embedding: [0, 0, 1] }; // cosine 0
    const result = computeSimilarAndRelatedQuestions(target, [unrelated]);
    expect(result.similarQuestions).toHaveLength(0);
    expect(result.relatedQuestions).toHaveLength(0);
  });

  it("excludes candidates already merged into the same cluster as the target", () => {
    const clusterMate: FaqRecord = { id: "c", question: "Refund policy?", answer: "...", source: "heuristic", isDuplicate: true, duplicateOfFaqId: "t", embedding: [0.99, 0.1411, 0] }; // cosine 0.99 — would be "similar" if not excluded by cluster membership
    const result = computeSimilarAndRelatedQuestions(target, [clusterMate]);
    expect(result.similarQuestions).toHaveLength(0);
    expect(result.relatedQuestions).toHaveLength(0);
  });

  it("respects the k limit per tier", () => {
    const many: FaqRecord[] = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, question: `Similar q ${i}`, answer: "...", source: "heuristic", isDuplicate: false, duplicateOfFaqId: null, embedding: [0.9, 0.1, 0] }));
    const result = computeSimilarAndRelatedQuestions(target, many, { k: 3 });
    expect(result.similarQuestions).toHaveLength(3);
  });
});
