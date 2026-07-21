import { describe, it, expect } from "vitest";
import { computeRelatedServices, extractDependencies } from "./serviceLearning";

describe("computeRelatedServices", () => {
  const target = { id: "s1", name: "Cloud Migration", industries: ["Finance", "Healthcare"], embedding: [1, 0, 0] };

  it("ranks by cosine similarity, excluding the target itself", () => {
    const candidates = [
      { id: "s1", name: "Cloud Migration", industries: ["Finance"], embedding: [1, 0, 0] }, // self
      { id: "s2", name: "Cloud Security Audit", industries: ["Retail"], embedding: [0.99, 0.1, 0] },
      { id: "s3", name: "Landscaping", industries: ["Retail"], embedding: [0, 0, 1] },
    ];
    const related = computeRelatedServices(target, candidates);
    expect(related.map((r) => r.id)).toEqual(["s2"]);
  });

  it("applies a shared-industry boost", () => {
    const sharedIndustry = { id: "s2", name: "Data Migration", industries: ["Finance"], embedding: [0.9, 0.1, 0] };
    const diffIndustry = { id: "s3", name: "Similar Vector Item", industries: ["Retail"], embedding: [0.9, 0.1, 0] };
    const related = computeRelatedServices(target, [sharedIndustry, diffIndustry], { minScore: 0 });
    const s2 = related.find((r) => r.id === "s2")!;
    const s3 = related.find((r) => r.id === "s3")!;
    expect(s2.score).toBeGreaterThan(s3.score);
    expect(s2.reason).toContain("Finance");
  });

  it("respects the k limit and minScore filter", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `Service ${i}`, industries: [], embedding: [1, 0, 0] }));
    expect(computeRelatedServices(target, many, { k: 4, minScore: 0 })).toHaveLength(4);
    expect(computeRelatedServices(target, [{ id: "far", name: "Far", industries: [], embedding: [0, 1, 0] }], { minScore: 0.5 })).toHaveLength(0);
  });
});

describe("extractDependencies", () => {
  it("returns null when nothing is stated", () => {
    expect(extractDependencies(null, null)).toBeNull();
    expect(extractDependencies("This service is fast and reliable for all customers.", null)).toBeNull();
  });

  it("extracts a real dependency sentence from the description", () => {
    const deps = extractDependencies("This add-on requires an active Cloud Migration subscription to function correctly.", null);
    expect(deps).toEqual(["This add-on requires an active Cloud Migration subscription to function correctly."]);
  });

  it("extracts dependencies from workflow steps too", () => {
    const deps = extractDependencies(null, ["Step 1: sign up.", "Step 2: this step depends on completing your account verification first."]);
    expect(deps).toEqual(["Step 2: this step depends on completing your account verification first."]);
  });

  it("combines description and workflow sources, capped at 5", () => {
    const workflow = Array.from({ length: 6 }, (_, i) => `This step requires completing prerequisite number ${i} beforehand.`);
    const deps = extractDependencies("This requires an active subscription to proceed further.", workflow);
    expect(deps).toHaveLength(5);
  });
});
