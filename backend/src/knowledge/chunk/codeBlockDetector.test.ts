import { describe, it, expect } from "vitest";
import { splitCodeFences, looksLikeCode } from "./codeBlockDetector";

describe("splitCodeFences", () => {
  it("returns the whole text as one text segment when there are no fences", () => {
    const segments = splitCodeFences("Just a normal paragraph.");
    expect(segments).toEqual([{ type: "text", content: "Just a normal paragraph." }]);
  });

  it("extracts a fenced code block with its language, keeping surrounding text separate", () => {
    const text = "Before.\n\n```js\nconst x = 1;\n```\n\nAfter.";
    const segments = splitCodeFences(text);
    expect(segments.map((s) => s.type)).toEqual(["text", "code", "text"]);
    expect(segments[1].content).toBe("const x = 1;");
    expect(segments[1].language).toBe("js");
  });

  it("handles multiple fenced blocks in one text", () => {
    const text = "```py\nprint(1)\n```\nmiddle\n```py\nprint(2)\n```";
    const segments = splitCodeFences(text);
    const code = segments.filter((s) => s.type === "code");
    expect(code).toHaveLength(2);
    expect(code[0].content).toBe("print(1)");
    expect(code[1].content).toBe("print(2)");
  });
});

describe("looksLikeCode", () => {
  it("flags a multi-line block with braces and keywords", () => {
    expect(looksLikeCode("function add(a, b) {\n  return a + b;\n}")).toBe(true);
  });

  it("does not flag ordinary prose", () => {
    expect(looksLikeCode("This is a normal sentence about our product.\nIt has two lines of prose.")).toBe(false);
  });

  it("does not flag a single line even if it has code-like symbols", () => {
    expect(looksLikeCode("Use the {curly} syntax here.")).toBe(false);
  });
});
