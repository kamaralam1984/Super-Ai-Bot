import { describe, it, expect } from "vitest";
import { serializeTableToMarkdown } from "./tableSerializer";

describe("serializeTableToMarkdown", () => {
  it("returns an empty string for no rows", () => {
    expect(serializeTableToMarkdown([])).toBe("");
  });

  it("renders a header + separator + body rows", () => {
    const md = serializeTableToMarkdown([
      ["Name", "Price"],
      ["Widget", "$10"],
      ["Gadget", "$20"],
    ]);
    expect(md.split("\n")).toEqual(["| Name | Price |", "| --- | --- |", "| Widget | $10 |", "| Gadget | $20 |"]);
  });

  it("pads short rows out to the widest row's column count", () => {
    const md = serializeTableToMarkdown([["A", "B", "C"], ["1"]]);
    expect(md).toContain("| 1 |  |  |");
  });

  it("escapes pipe characters inside cells so they don't break the table structure", () => {
    const md = serializeTableToMarkdown([["Name"], ["A | B"]]);
    expect(md).toContain("A \\| B");
  });
});
