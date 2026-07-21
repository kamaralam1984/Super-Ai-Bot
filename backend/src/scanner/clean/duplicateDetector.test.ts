import { describe, it, expect } from "vitest";
import { DuplicateTracker } from "./duplicateDetector";

describe("DuplicateTracker", () => {
  it("treats the first occurrence of content as unique", () => {
    const tracker = new DuplicateTracker();
    expect(tracker.check("paragraph", "Free shipping on all orders.", "/page-a")).toBeNull();
  });

  it("flags the second occurrence of identical content as a duplicate, pointing at the first source", () => {
    const tracker = new DuplicateTracker();
    tracker.check("paragraph", "Free shipping on all orders.", "/page-a");
    const result = tracker.check("paragraph", "Free shipping on all orders.", "/page-b");
    expect(result).toBe("/page-a");
  });

  it("is case- and whitespace-insensitive", () => {
    const tracker = new DuplicateTracker();
    tracker.check("heading", "  Our   Services  ", "/page-a");
    expect(tracker.check("heading", "our services", "/page-b")).toBe("/page-a");
  });

  it("keeps categories independent — the same text isn't a cross-category duplicate", () => {
    const tracker = new DuplicateTracker();
    tracker.check("heading", "Contact Us", "/page-a");
    expect(tracker.check("paragraph", "Contact Us", "/page-b")).toBeNull();
  });

  it("never flags empty/whitespace-only content", () => {
    const tracker = new DuplicateTracker();
    tracker.check("paragraph", "   ", "/page-a");
    expect(tracker.check("paragraph", "", "/page-b")).toBeNull();
  });

  it("filterUnique removes duplicates while preserving first occurrences", () => {
    const tracker = new DuplicateTracker();
    const paragraphs = [
      { text: "Welcome to our site.", url: "/" },
      { text: "Free shipping on all orders.", url: "/" },
      { text: "Free shipping on all orders.", url: "/about" }, // boilerplate repeated
      { text: "We are a family business.", url: "/about" },
    ];
    const { unique, duplicateCount } = tracker.filterUnique("paragraph", paragraphs, (p) => p.text, (p) => p.url);
    expect(unique.map((p) => p.text)).toEqual(["Welcome to our site.", "Free shipping on all orders.", "We are a family business."]);
    expect(duplicateCount).toBe(1);
  });

  it("reports per-category counts of unique items seen", () => {
    const tracker = new DuplicateTracker();
    tracker.check("page", "hash-a", "/a");
    tracker.check("page", "hash-b", "/b");
    tracker.check("heading", "Contact", "/a");
    expect(tracker.stats()).toEqual({ page: 2, heading: 1 });
  });

  it("reports per-category counts of duplicate hits distinctly from unique counts (regression: these were conflated)", () => {
    const tracker = new DuplicateTracker();
    tracker.check("page", "Home page content", "/"); // unique
    tracker.check("page", "Home page content", "/index.html"); // duplicate of "/"
    tracker.check("page", "About page content", "/about"); // unique
    tracker.check("heading", "Contact", "/a");
    tracker.check("heading", "Contact", "/b"); // duplicate

    expect(tracker.stats()).toEqual({ page: 2, heading: 1 }); // 2 distinct pages, 1 distinct heading
    expect(tracker.duplicateStats()).toEqual({ page: 1, heading: 1 }); // 1 repeat page, 1 repeat heading
  });
});
