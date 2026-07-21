import { describe, it, expect } from "vitest";
import { parsePageContent } from "../parse/htmlParser";
import { buildCleanText } from "./contentCleaner";

describe("NOISE_SELECTORS integration (via parsePageContent)", () => {
  it("strips cookie consent banners from extracted paragraphs", () => {
    const html = `<body>
      <div class="cookie-consent-banner"><p>We use cookies to improve your experience.</p></div>
      <p>Real page content about our products.</p>
    </body>`;
    const result = parsePageContent(html);
    expect(result.paragraphs).toEqual(["Real page content about our products."]);
  });

  it("strips Google AdSense ad units from extracted paragraphs", () => {
    const html = `<body>
      <ins class="adsbygoogle"><p>Ad content should not appear</p></ins>
      <p>Genuine article content.</p>
    </body>`;
    const result = parsePageContent(html);
    expect(result.paragraphs).toEqual(["Genuine article content."]);
  });
});

describe("buildCleanText", () => {
  it("assembles title, headings, paragraphs, lists, and tables into one text blob", () => {
    const html = `<html><head><title>Acme Widgets</title></head><body>
      <h1>Best Widgets</h1>
      <p>We make the best widgets in town.</p>
      <ul><li>Durable</li><li>Affordable</li></ul>
      <table><tbody><tr><td>Small</td><td>$5</td></tr></tbody></table>
    </body></html>`;
    const text = buildCleanText(parsePageContent(html));
    expect(text).toContain("Acme Widgets");
    expect(text).toContain("Best Widgets");
    expect(text).toContain("We make the best widgets in town.");
    expect(text).toContain("Durable; Affordable");
    expect(text).toContain("Small | $5");
  });

  it("de-duplicates identical lines within the same page", () => {
    const html = `<html><head><title>Contact</title></head><body>
      <h1>Contact</h1>
      <p>Contact</p>
    </body></html>`;
    const text = buildCleanText(parsePageContent(html));
    expect(text.split("\n\n").filter((line) => line === "Contact")).toHaveLength(1);
  });
});
