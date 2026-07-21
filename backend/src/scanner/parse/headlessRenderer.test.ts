import { describe, it, expect } from "vitest";
import { isLikelyJsShell } from "./headlessRenderer";

describe("isLikelyJsShell", () => {
  it("flags a typical SPA shell with an empty root div", () => {
    const html = `<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;
    expect(isLikelyJsShell(html)).toBe(true);
  });

  it("does not flag a normal server-rendered content page", () => {
    const html = `<html><body>
      <h1>Welcome to Acme</h1>
      <p>${"Acme has been building quality widgets since 1990. ".repeat(6)}</p>
      <script src="/analytics.js"></script>
    </body></html>`;
    expect(isLikelyJsShell(html)).toBe(false);
  });

  it("does not flag a short page with no scripts at all", () => {
    const html = `<html><body><p>Hi</p></body></html>`;
    expect(isLikelyJsShell(html)).toBe(false);
  });
});
