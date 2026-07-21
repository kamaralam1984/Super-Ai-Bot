import { describe, it, expect } from "vitest";
import { chunkText, chunkBlocks } from "./chunker";

describe("chunkText (flat text -> Markdown-structure-aware chunks)", () => {
  it("returns an empty array for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n   ")).toEqual([]);
  });

  it("keeps short text as a single PARAGRAPH chunk with no section", () => {
    const chunks = chunkText("This is a short paragraph about widgets.", 800, 120);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("This is a short paragraph about widgets.");
    expect(chunks[0].chunkType).toBe("PARAGRAPH");
    expect(chunks[0].title).toBeNull();
    expect(chunks[0].index).toBe(0);
  });

  it("groups multiple small paragraphs into one chunk under the size limit", () => {
    const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    const chunks = chunkText(text, 800, 120);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Paragraph one.");
    expect(chunks[0].content).toContain("Paragraph three.");
  });

  it("starts a new chunk once adding a paragraph would exceed chunkSize", () => {
    const paragraphA = "A".repeat(60) + ".";
    const paragraphB = "B".repeat(60) + ".";
    const chunks = chunkText(`${paragraphA}\n\n${paragraphB}`, 100, 10);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].content).toBe(paragraphA);
  });

  it("hard-splits a single sentence that exceeds chunkSize on its own", () => {
    const longParagraph = "word ".repeat(400).trim() + "."; // ~2000 chars, one giant sentence
    const chunks = chunkText(longParagraph, 500, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(500);
    }
  });

  it("assigns sequential zero-based indices", () => {
    const text = "One.\n\n" + "X".repeat(900) + ".\n\nThree.";
    const chunks = chunkText(text, 500, 50);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_c, i) => i));
  });

  it("tags a paragraph under a heading as HEADING_SECTION with title/section set", () => {
    const text = "# Pricing\n\nOur plans start at $10/month and scale from there.";
    const chunks = chunkText(text, 800, 120);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkType).toBe("HEADING_SECTION");
    expect(chunks[0].title).toBe("Pricing");
    expect(chunks[0].section).toBe("Pricing");
  });

  it("builds a nested section path from heading levels and pops back on a same/higher-level heading", () => {
    const text = [
      "# Products",
      "",
      "## Widgets",
      "",
      "We sell high quality widgets.",
      "",
      "## Gadgets",
      "",
      "We also sell gadgets.",
      "",
      "# Support",
      "",
      "Contact us any time.",
    ].join("\n");
    const chunks = chunkText(text, 800, 120);

    const widgetsChunk = chunks.find((c) => c.content.includes("widgets"));
    const gadgetsChunk = chunks.find((c) => c.content.includes("gadgets"));
    const supportChunk = chunks.find((c) => c.content.includes("Contact us"));

    expect(widgetsChunk?.section).toBe("Products > Widgets");
    expect(gadgetsChunk?.section).toBe("Products > Gadgets");
    expect(supportChunk?.section).toBe("Support");
  });

  it("keeps a Markdown pipe table intact as a single TABLE chunk", () => {
    const text = ["# Specs", "", "| Name | Price |", "| --- | --- |", "| Widget | $10 |", "| Gadget | $20 |"].join("\n");
    const chunks = chunkText(text, 800, 120);
    const tableChunk = chunks.find((c) => c.chunkType === "TABLE");
    expect(tableChunk).toBeDefined();
    expect(tableChunk?.content).toContain("| Name | Price |");
    expect(tableChunk?.content).toContain("| Widget | $10 |");
    expect(tableChunk?.content).toContain("| Gadget | $20 |");
    expect(tableChunk?.section).toBe("Specs");
  });

  it("keeps a fenced code block intact as a single CODE chunk, untouched by prose splitting", () => {
    const code = "function add(a, b) {\n  return a + b;\n}";
    const text = `Here is an example.\n\n\`\`\`js\n${code}\n\`\`\`\n\nThat's how it works.`;
    const chunks = chunkText(text, 800, 120);
    const codeChunk = chunks.find((c) => c.chunkType === "CODE");
    expect(codeChunk).toBeDefined();
    expect(codeChunk?.content).toBe(code);
  });

  it("groups list items into a LIST chunk, separate from surrounding paragraphs", () => {
    const text = "Our features include:\n\n- Fast performance\n- Easy setup\n- 24/7 support\n\nThanks for reading.";
    const chunks = chunkText(text, 800, 120);
    const listChunk = chunks.find((c) => c.chunkType === "LIST");
    expect(listChunk).toBeDefined();
    expect(listChunk?.content).toBe("- Fast performance\n- Easy setup\n- 24/7 support");
  });

  it("detects an un-fenced code-like paragraph as a CODE chunk", () => {
    const text = "const total = price * quantity;\nfunction checkout() {\n  return total;\n}";
    const chunks = chunkText(text, 800, 120);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkType).toBe("CODE");
  });

  it("never drops content across chunk boundaries for real multi-section text", () => {
    const text = [
      "# Overview",
      "",
      "Acme Corp has been building tools since 1998. " + "We serve thousands of customers worldwide. ".repeat(20),
      "",
      "## Contact",
      "",
      "- Email: support@acme.test",
      "- Phone: 555-0100",
    ].join("\n");
    const chunks = chunkText(text, 400, 50);
    const allText = chunks.map((c) => c.content).join(" ");
    expect(allText).toContain("Acme Corp has been building tools since 1998.");
    expect(allText).toContain("support@acme.test");
  });
});

describe("chunkBlocks (structured input)", () => {
  it("tags top-level paragraphs (no heading) as PARAGRAPH, not HEADING_SECTION", () => {
    const chunks = chunkBlocks([{ kind: "paragraph", text: "No heading above this." }]);
    expect(chunks[0].chunkType).toBe("PARAGRAPH");
    expect(chunks[0].section).toBeNull();
  });

  it("serializes a directly-provided table (e.g. from a DOCX/XLSX extractor) as TABLE", () => {
    const chunks = chunkBlocks([
      { kind: "heading", level: 1, text: "Team" },
      {
        kind: "table",
        rows: [
          ["Name", "Role"],
          ["Asha", "Engineer"],
          ["Raj", "Designer"],
        ],
      },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkType).toBe("TABLE");
    expect(chunks[0].content).toContain("Asha");
    expect(chunks[0].section).toBe("Team");
  });
});
