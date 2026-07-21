import { describe, it, expect } from "vitest";
import { planIncrementalRecrawl, summarizePlan } from "./changeDetector";

describe("planIncrementalRecrawl", () => {
  it("classifies a page present in both with the same hash as unchanged", () => {
    const plan = planIncrementalRecrawl([{ url: "/a", contentHash: "hash1" }], [{ url: "/a", contentHash: "hash1" }]);
    expect(plan.unchangedUrls).toEqual(["/a"]);
    expect(plan.modifiedUrls).toEqual([]);
  });

  it("classifies a page present in both with a different hash as modified", () => {
    const plan = planIncrementalRecrawl([{ url: "/a", contentHash: "hash1" }], [{ url: "/a", contentHash: "hash2" }]);
    expect(plan.modifiedUrls).toEqual(["/a"]);
    expect(plan.unchangedUrls).toEqual([]);
  });

  it("classifies a page only in the current crawl as new", () => {
    const plan = planIncrementalRecrawl([], [{ url: "/new-page", contentHash: "hash1" }]);
    expect(plan.newUrls).toEqual(["/new-page"]);
  });

  it("classifies a page only in the previous crawl as deleted", () => {
    const plan = planIncrementalRecrawl([{ url: "/gone", contentHash: "hash1" }], []);
    expect(plan.deletedUrls).toEqual(["/gone"]);
  });

  it("handles a realistic mixed recrawl correctly", () => {
    const previous = [
      { url: "/home", contentHash: "h-home-1" },
      { url: "/about", contentHash: "h-about-1" },
      { url: "/old-promo", contentHash: "h-promo-1" },
    ];
    const current = [
      { url: "/home", contentHash: "h-home-1" }, // unchanged
      { url: "/about", contentHash: "h-about-2" }, // modified
      { url: "/new-product", contentHash: "h-new-1" }, // new
      // /old-promo is gone -> deleted
    ];
    const plan = planIncrementalRecrawl(previous, current);
    expect(plan.unchangedUrls).toEqual(["/home"]);
    expect(plan.modifiedUrls).toEqual(["/about"]);
    expect(plan.newUrls).toEqual(["/new-product"]);
    expect(plan.deletedUrls).toEqual(["/old-promo"]);
  });

  it("treats a previously-null contentHash as always different from a real hash", () => {
    const plan = planIncrementalRecrawl([{ url: "/a", contentHash: null }], [{ url: "/a", contentHash: "hash1" }]);
    expect(plan.modifiedUrls).toEqual(["/a"]);
  });
});

describe("summarizePlan", () => {
  it("computes a change ratio reflecting new+modified+deleted over total", () => {
    const plan = { newUrls: ["/a"], modifiedUrls: ["/b"], unchangedUrls: ["/c", "/d"], deletedUrls: [] };
    const summary = summarizePlan(plan, 4, 4);
    expect(summary.changeRatio).toBeCloseTo(0.5); // 2 changed / 4 total
  });
});
