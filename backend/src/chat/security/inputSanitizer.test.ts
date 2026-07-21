import { describe, it, expect } from "vitest";
import { escapeHtml, MAX_MESSAGE_LENGTH, sanitizeUserInput } from "./inputSanitizer";

describe("sanitizeUserInput", () => {
  it("trims leading/trailing whitespace", () => {
    expect(sanitizeUserInput("  hello  ")).toBe("hello");
  });

  it("preserves normal punctuation and multi-line text (tab/newline kept)", () => {
    expect(sanitizeUserInput("Line one\nLine two\twith a tab")).toBe("Line one\nLine two\twith a tab");
  });

  it("strips a null byte", () => {
    expect(sanitizeUserInput(`hello${String.fromCharCode(0)}world`)).toBe("helloworld");
  });

  it("strips a bell/escape/other C0 control character", () => {
    expect(sanitizeUserInput(`hi${String.fromCharCode(7)}there${String.fromCharCode(27)}!`)).toBe("hithere!");
  });

  it("strips carriage return", () => {
    expect(sanitizeUserInput("hello\rworld")).toBe("helloworld");
  });

  it("strips DEL (127)", () => {
    expect(sanitizeUserInput(`abc${String.fromCharCode(127)}def`)).toBe("abcdef");
  });

  it("caps length at MAX_MESSAGE_LENGTH", () => {
    const huge = "x".repeat(MAX_MESSAGE_LENGTH + 500);
    expect(sanitizeUserInput(huge)).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it("leaves ordinary unicode text (emoji, non-Latin scripts) untouched", () => {
    expect(sanitizeUserInput("नमस्ते 👋 مرحبا")).toBe("नमस्ते 👋 مرحبا");
  });
});

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert("x & 'y'")</script>`)).toBe("&lt;script&gt;alert(&quot;x &amp; &#39;y&#39;&quot;)&lt;/script&gt;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Hello, how can I help?")).toBe("Hello, how can I help?");
  });
});
