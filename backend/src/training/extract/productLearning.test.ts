import { describe, it, expect } from "vitest";
import { normalizeAvailability, extractBenefits, computeRelatedProducts } from "./productLearning";

describe("normalizeAvailability", () => {
  it("detects in_stock from stockStatus", () => {
    expect(normalizeAvailability("In Stock", null)).toBe("in_stock");
  });

  it("detects out_of_stock from stockStatus", () => {
    expect(normalizeAvailability("Out of Stock", null)).toBe("out_of_stock");
  });

  it("detects preorder from stockStatus", () => {
    expect(normalizeAvailability("Pre-order now", null)).toBe("preorder");
  });

  it("falls back to description when stockStatus is null", () => {
    expect(normalizeAvailability(null, "This item is currently sold out.")).toBe("out_of_stock");
  });

  it("prefers stockStatus over a conflicting description", () => {
    expect(normalizeAvailability("In Stock", "coming soon")).toBe("in_stock");
  });

  it("returns unknown when neither source has a recognizable signal", () => {
    expect(normalizeAvailability(null, null)).toBe("unknown");
    expect(normalizeAvailability("Premium Quality", "A great product for everyone.")).toBe("unknown");
  });

  it("discontinued counts as out_of_stock", () => {
    expect(normalizeAvailability("Discontinued", null)).toBe("out_of_stock");
  });
});

describe("extractBenefits", () => {
  it("returns null for null description", () => {
    expect(extractBenefits(null)).toBeNull();
  });

  it("extracts sentences with real benefit-phrase signals", () => {
    const benefits = extractBenefits("This blender has a 1000W motor. It helps you make smoothies in seconds. The body is made of stainless steel.");
    expect(benefits).toEqual(["It helps you make smoothies in seconds."]);
  });

  it("extracts multiple benefit sentences, capped at 5", () => {
    const description = Array.from({ length: 8 }, (_, i) => `This helps you save time in scenario number ${i}.`).join(" ");
    const benefits = extractBenefits(description);
    expect(benefits).toHaveLength(5);
  });

  it("returns null when no sentence reads as a benefit claim", () => {
    expect(extractBenefits("Weight: 2kg. Dimensions: 30x20x10cm. Material: stainless steel.")).toBeNull();
  });

  it("ignores very short fragments even if they contain a benefit keyword", () => {
    const benefits = extractBenefits("Enjoy! Full specs below: weight 2kg, material steel, warranty 1 year included with purchase.");
    expect(benefits).toBeNull();
  });
});

describe("computeRelatedProducts", () => {
  const target = { id: "p1", name: "Wireless Mouse", category: "Electronics", embedding: [1, 0, 0] };

  it("ranks by cosine similarity, excluding the target itself", () => {
    const candidates = [
      { id: "p1", name: "Wireless Mouse", category: "Electronics", embedding: [1, 0, 0] }, // self, must be excluded
      { id: "p2", name: "Wireless Keyboard", category: "Electronics", embedding: [0.99, 0.1, 0] },
      { id: "p3", name: "Garden Hose", category: "Outdoor", embedding: [0, 0, 1] },
    ];
    const related = computeRelatedProducts(target, candidates);
    expect(related.map((r) => r.id)).toEqual(["p2"]);
  });

  it("applies a same-category boost", () => {
    const sameCategory = { id: "p2", name: "Wireless Keyboard", category: "Electronics", embedding: [0.9, 0.1, 0] };
    const diffCategory = { id: "p3", name: "Similar Vector Item", category: "Outdoor", embedding: [0.9, 0.1, 0] };
    const related = computeRelatedProducts(target, [sameCategory, diffCategory], { minScore: 0 });
    const p2 = related.find((r) => r.id === "p2")!;
    const p3 = related.find((r) => r.id === "p3")!;
    expect(p2.score).toBeGreaterThan(p3.score);
  });

  it("respects the k limit", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Product ${i}`, category: "Electronics", embedding: [1, 0, 0] }));
    const related = computeRelatedProducts(target, candidates, { k: 3, minScore: 0 });
    expect(related).toHaveLength(3);
  });

  it("filters out candidates below minScore", () => {
    const unrelated = { id: "p9", name: "Unrelated", category: "Other", embedding: [0, 1, 0] };
    const related = computeRelatedProducts(target, [unrelated], { minScore: 0.5 });
    expect(related).toHaveLength(0);
  });

  it("never scores above 1 even with the category boost applied to a perfect match", () => {
    const identical = { id: "p2", name: "Identical", category: "Electronics", embedding: [1, 0, 0] };
    const related = computeRelatedProducts(target, [identical]);
    expect(related[0].score).toBeLessThanOrEqual(1);
  });
});
