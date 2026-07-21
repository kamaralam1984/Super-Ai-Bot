import { describe, it, expect } from "vitest";
import { formatSourceReferences } from "./sourceReferenceFormatter";
import type { CitationSource } from "../../knowledge/citation/citationFormatter";

function source(overrides: Partial<CitationSource> = {}): CitationSource {
  return { chunkId: "chunk-1", sourceUrl: "https://example.com/products/widget-pro", title: null, category: "Products", excerpt: "...", confidenceScore: 0.9, relevanceScore: 0.8, ...overrides };
}

describe("formatSourceReferences", () => {
  it("uses the chunk's title as documentName when present", () => {
    const [ref] = formatSourceReferences([source({ title: "Widget Pro" })]);
    expect(ref.documentName).toBe("Widget Pro");
  });

  it("derives a document name from the URL when there is no title", () => {
    const [ref] = formatSourceReferences([source({ title: null, sourceUrl: "https://example.com/products/widget-pro" })]);
    expect(ref.documentName).toBe("widget pro");
  });

  it("falls back to the raw URL when it can't be parsed", () => {
    const [ref] = formatSourceReferences([source({ title: null, sourceUrl: "not a url" })]);
    expect(ref.documentName).toBe("not a url");
  });

  it("maps category to sectionName and preserves confidence/relevance scores", () => {
    const [ref] = formatSourceReferences([source({ category: "FAQs", confidenceScore: 0.7, relevanceScore: 0.6 })]);
    expect(ref.sectionName).toBe("FAQs");
    expect(ref.confidenceScore).toBe(0.7);
    expect(ref.relevanceScore).toBe(0.6);
  });

  it("stamps every reference with the same retrievedAt timestamp", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const refs = formatSourceReferences([source(), source({ chunkId: "chunk-2" })], now);
    expect(refs[0].retrievedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(refs[1].retrievedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("preserves chunkId and pageUrl", () => {
    const [ref] = formatSourceReferences([source({ chunkId: "abc", sourceUrl: "https://example.com/x" })]);
    expect(ref.chunkId).toBe("abc");
    expect(ref.pageUrl).toBe("https://example.com/x");
  });
});
