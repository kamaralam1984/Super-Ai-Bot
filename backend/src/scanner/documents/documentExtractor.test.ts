import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { extractDocumentText } from "./documentExtractor";

describe("extractDocumentText", () => {
  it("passes through TXT content as-is", async () => {
    const result = await extractDocumentText(Buffer.from("Hello, world.\nLine two."), "TXT");
    expect(result.text).toBe("Hello, world.\nLine two.");
    expect(result.error).toBeNull();
  });

  it("passes through Markdown content as-is", async () => {
    const result = await extractDocumentText(Buffer.from("# Heading\n\nSome **bold** text."), "MARKDOWN");
    expect(result.text).toContain("# Heading");
  });

  it("extracts headings and hyperlinks from Markdown", async () => {
    const md = "# Title\n\nIntro text.\n\n## Section One\n\nSee [our docs](https://acme.com/docs) for more.\n\n### Subsection";
    const result = await extractDocumentText(Buffer.from(md), "MARKDOWN");
    expect(result.headings).toEqual(["Title", "Section One", "Subsection"]);
    expect(result.hyperlinks).toEqual([{ text: "our docs", url: "https://acme.com/docs" }]);
  });

  it("parses CSV rows into pipe-delimited text and a table structure", async () => {
    const csv = "name,price\nWidget,9.99\nGadget,19.99";
    const result = await extractDocumentText(Buffer.from(csv), "CSV");
    expect(result.text).toBe("name | price\nWidget | 9.99\nGadget | 19.99");
    expect(result.tables).toEqual([[["name", "price"], ["Widget", "9.99"], ["Gadget", "19.99"]]]);
  });

  it("flattens JSON into newline-separated text values", async () => {
    const json = JSON.stringify({ name: "Acme", products: [{ name: "Widget" }, { name: "Gadget" }] });
    const result = await extractDocumentText(Buffer.from(json), "JSON");
    expect(result.text).toContain("Acme");
    expect(result.text).toContain("Widget");
    expect(result.text).toContain("Gadget");
  });

  it("flattens well-formed XML into readable text", async () => {
    const xml = `<catalog><product><name>Widget</name><price>9.99</price></product></catalog>`;
    const result = await extractDocumentText(Buffer.from(xml), "XML");
    expect(result.text).toContain("Widget");
    expect(result.text).toContain("9.99");
    expect(result.error).toBeNull();
  });

  it("falls back to a tag-stripped result for malformed XML instead of throwing", async () => {
    const malformed = `<catalog><product><name>Widget</name></catalog>`; // unclosed <product>
    const result = await extractDocumentText(Buffer.from(malformed), "XML");
    expect(result.text).toContain("Widget");
  });

  it("reports an error for malformed JSON without throwing", async () => {
    const result = await extractDocumentText(Buffer.from("{not valid json"), "JSON");
    expect(result.error).toContain("JSON parse error");
    expect(result.text).toBe("");
  });

  it("extracts XLSX workbook metadata and cell hyperlinks", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.title = "Product Catalog";
    workbook.creator = "Acme Corp";
    const sheet = workbook.addWorksheet("Products");
    sheet.addRow(["Name", "Link"]);
    const row = sheet.addRow(["Widget", "See details"]);
    row.getCell(2).value = { text: "See details", hyperlink: "https://acme.com/widget" };
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await extractDocumentText(buffer, "XLSX");
    expect(result.metadata.title).toBe("Product Catalog");
    expect(result.metadata.creator).toBe("Acme Corp");
    expect(result.hyperlinks).toContainEqual({ text: "See details", url: "https://acme.com/widget" });
  });

  it("rejects documents over the size cap before attempting to parse", async () => {
    const oversized = Buffer.alloc(26 * 1024 * 1024);
    const result = await extractDocumentText(oversized, "TXT");
    expect(result.error).toContain("exceeds");
    expect(result.text).toBe("");
  });
});
