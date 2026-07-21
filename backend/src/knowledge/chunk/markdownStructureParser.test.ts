import { describe, it, expect } from "vitest";
import { parseTextIntoBlocks } from "./markdownStructureParser";

describe("parseTextIntoBlocks", () => {
  it("returns an empty array for empty text", () => {
    expect(parseTextIntoBlocks("")).toEqual([]);
  });

  it("parses a heading followed by a paragraph", () => {
    const blocks = parseTextIntoBlocks("# Title\n\nSome body text.");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "Title" },
      { kind: "paragraph", text: "Some body text." },
    ]);
  });

  it("parses a bulleted list into one list block with all items", () => {
    const blocks = parseTextIntoBlocks("- one\n- two\n- three");
    expect(blocks).toEqual([{ kind: "list", items: ["one", "two", "three"] }]);
  });

  it("parses a numbered list", () => {
    const blocks = parseTextIntoBlocks("1. first\n2. second");
    expect(blocks).toEqual([{ kind: "list", items: ["first", "second"] }]);
  });

  it("parses a Markdown pipe table with its separator row consumed (not a data row)", () => {
    const blocks = parseTextIntoBlocks("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          ["A", "B"],
          ["1", "2"],
        ],
      },
    ]);
  });

  it("parses a fenced code block with language", () => {
    const blocks = parseTextIntoBlocks("```ts\nconst x = 1;\n```");
    expect(blocks).toEqual([{ kind: "code", text: "const x = 1;", language: "ts" }]);
  });

  it("does not misparse a normal paragraph containing a pipe character as a table", () => {
    const blocks = parseTextIntoBlocks("This has a | in it but is not a table.");
    expect(blocks).toEqual([{ kind: "paragraph", text: "This has a | in it but is not a table." }]);
  });
});
