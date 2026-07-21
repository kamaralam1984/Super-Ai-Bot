import { describe, it, expect } from "vitest";
import { validateKnowledgeUnit, validateBatch } from "./knowledgeValidator";

describe("validateKnowledgeUnit", () => {
  it("passes clean, real content with no issues", () => {
    const issues = validateKnowledgeUnit({ sourceUrl: "https://example.com/about", content: "We are a company that builds great products for our customers around the world." });
    expect(issues).toHaveLength(0);
  });

  it("flags missing sourceUrl as an error", () => {
    const issues = validateKnowledgeUnit({ sourceUrl: "", content: "Some real content here that is long enough." });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "error", code: "missing_source" }));
  });

  it("flags empty content as an error and stops further checks", () => {
    const issues = validateKnowledgeUnit({ sourceUrl: "https://example.com", content: "   " });
    expect(issues).toEqual([{ severity: "error", code: "empty_content", message: expect.any(String), context: { sourceUrl: "https://example.com" } }]);
  });

  it("flags very short content as a warning, not an error", () => {
    const issues = validateKnowledgeUnit({ sourceUrl: "https://example.com", content: "Hi there" });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "warning", code: "content_too_short" }));
  });

  it("flags content dominated by replacement characters as broken encoding", () => {
    const broken = "���� ���� corrupted text ���� more ���� broken ���� data ���� everywhere ����";
    const issues = validateKnowledgeUnit({ sourceUrl: "https://example.com", content: broken });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "error", code: "encoding_broken" }));
  });

  it("does not flag content with only an occasional, incidental replacement character", () => {
    const mostlyClean = "This is a long paragraph of real, legitimate content about our company and its history. ".repeat(3) + "A single stray � character appears here.";
    const issues = validateKnowledgeUnit({ sourceUrl: "https://example.com", content: mostlyClean });
    expect(issues.find((i) => i.code === "encoding_broken")).toBeUndefined();
  });

  it("flags a short phrase repeated many times as a scraping artifact", () => {
    const repetitive = "Home Home Home Home Home Home Home Home Home Home Home Home Home Home Home Home Home Home Home Home Home";
    const issues = validateKnowledgeUnit({ sourceUrl: "https://example.com", content: repetitive });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "warning", code: "repetitive_content" }));
  });

  it("does not flag genuinely diverse real prose as repetitive", () => {
    const realProse =
      "Our company was founded in 2010 with a mission to provide excellent customer service. Since then, we have grown to serve thousands of clients across many industries. We believe in quality, integrity, and innovation in everything we do.";
    const issues = validateKnowledgeUnit({ sourceUrl: "https://example.com", content: realProse });
    expect(issues.find((i) => i.code === "repetitive_content")).toBeUndefined();
  });

  it("does not flag short content (under the repetition word-count floor) as repetitive even if words repeat", () => {
    const issues = validateKnowledgeUnit({ sourceUrl: "https://example.com", content: "Yes yes yes yes" });
    expect(issues.find((i) => i.code === "repetitive_content")).toBeUndefined();
  });
});

describe("validateBatch", () => {
  it("keeps units with no errors and drops units with errors, while collecting all issues", () => {
    const units = [
      { sourceUrl: "https://example.com/a", content: "This is genuinely good, real content about our company and services." },
      { sourceUrl: "", content: "Missing source url but otherwise fine content that is long enough." },
      { sourceUrl: "https://example.com/c", content: "" },
    ];
    const result = validateBatch(units);
    expect(result.validUnits).toEqual([units[0]]);
    expect(result.issues.some((i) => i.code === "missing_source")).toBe(true);
    expect(result.issues.some((i) => i.code === "empty_content")).toBe(true);
  });

  it("keeps a unit that only has warnings", () => {
    const units = [{ sourceUrl: "https://example.com/short", content: "Hi" }];
    const result = validateBatch(units);
    expect(result.validUnits).toEqual(units);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "warning" }));
  });

  it("returns empty results for an empty batch", () => {
    expect(validateBatch([])).toEqual({ validUnits: [], issues: [] });
  });
});
