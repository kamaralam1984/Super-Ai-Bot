import { describe, it, expect } from "vitest";
import { classifyDocumentUrl, findDocumentLinks } from "./documentDiscovery";

describe("classifyDocumentUrl", () => {
  it("classifies each supported extension", () => {
    expect(classifyDocumentUrl("https://acme.com/brochure.pdf")).toBe("PDF");
    expect(classifyDocumentUrl("https://acme.com/report.docx")).toBe("DOCX");
    expect(classifyDocumentUrl("https://acme.com/legacy.doc")).toBe("DOC");
    expect(classifyDocumentUrl("https://acme.com/data.xlsx")).toBe("XLSX");
    expect(classifyDocumentUrl("https://acme.com/export.csv")).toBe("CSV");
    expect(classifyDocumentUrl("https://acme.com/notes.txt")).toBe("TXT");
    expect(classifyDocumentUrl("https://acme.com/readme.md")).toBe("MARKDOWN");
    expect(classifyDocumentUrl("https://acme.com/feed.xml")).toBe("XML");
    expect(classifyDocumentUrl("https://acme.com/config.json")).toBe("JSON");
  });

  it("returns null for non-document URLs", () => {
    expect(classifyDocumentUrl("https://acme.com/about")).toBeNull();
    expect(classifyDocumentUrl("https://acme.com/image.png")).toBeNull();
  });

  it("handles query strings and fragments after the extension", () => {
    expect(classifyDocumentUrl("https://acme.com/report.pdf?download=1")).toBe("PDF");
  });

  it("returns null for malformed URLs rather than throwing", () => {
    expect(classifyDocumentUrl("not a url")).toBeNull();
  });
});

describe("findDocumentLinks", () => {
  it("filters and dedupes a mixed link list", () => {
    const links = [
      "https://acme.com/about",
      "https://acme.com/brochure.pdf",
      "https://acme.com/brochure.pdf",
      "https://acme.com/data.xlsx",
      "https://acme.com/logo.png",
    ];
    const documents = findDocumentLinks(links);
    expect(documents).toEqual([
      { url: "https://acme.com/brochure.pdf", type: "PDF" },
      { url: "https://acme.com/data.xlsx", type: "XLSX" },
    ]);
  });
});
