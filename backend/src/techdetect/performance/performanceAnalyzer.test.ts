import { describe, it, expect } from "vitest";
import { analyzePerformance } from "./performanceAnalyzer";
import { buildSignals } from "../testFixtures";
import { collectSignals } from "../signals/signalCollector";

function findingFor(result: ReturnType<typeof analyzePerformance>, check: string) {
  const finding = result.findings.find((f) => f.check === check);
  if (!finding) throw new Error(`no finding for check "${check}"`);
  return finding;
}

describe("analyzePerformance", () => {
  it("does not report any image-related findings when the page has no <img> tags", () => {
    const result = analyzePerformance(buildSignals({ html: "<html><body>No images here</body></html>" }));
    expect(result.findings.some((f) => f.check === "Lazy Loading")).toBe(false);
    expect(result.findings.some((f) => f.check === "Image Optimization")).toBe(false);
  });

  it("passes Lazy Loading when at least one image uses loading=lazy", () => {
    const result = analyzePerformance(buildSignals({ html: '<img src="a.jpg" loading="lazy"><img src="b.jpg">' }));
    expect(findingFor(result, "Lazy Loading").passed).toBe(true);
  });

  it("passes the image-dimensions CWV indicator only when every image has explicit width/height", () => {
    const allDimensioned = analyzePerformance(buildSignals({ html: '<img src="a.jpg" width="100" height="100">' }));
    expect(findingFor(allDimensioned, "Core Web Vitals Indicator: Image Dimensions").passed).toBe(true);

    const partial = analyzePerformance(buildSignals({ html: '<img src="a.jpg" width="100" height="100"><img src="b.jpg">' }));
    expect(findingFor(partial, "Core Web Vitals Indicator: Image Dimensions").passed).toBe(false);
  });

  it("passes Image Optimization from WebP usage, <picture>, or srcset", () => {
    expect(findingFor(analyzePerformance(buildSignals({ html: '<img src="a.webp">' })), "Image Optimization").passed).toBe(true);
    expect(findingFor(analyzePerformance(buildSignals({ html: "<picture><source></picture><img src=\"a.jpg\">" })), "Image Optimization").passed).toBe(true);
    expect(findingFor(analyzePerformance(buildSignals({ html: '<img src="a.jpg" srcset="a-2x.jpg 2x">' })), "Image Optimization").passed).toBe(true);
    expect(findingFor(analyzePerformance(buildSignals({ html: '<img src="a.jpg">' })), "Image Optimization").passed).toBe(false);
  });

  it("passes Compression only when a real compression Content-Encoding is present", () => {
    expect(findingFor(analyzePerformance(buildSignals({ headers: { "content-encoding": "br" } })), "Compression").passed).toBe(true);
    expect(findingFor(analyzePerformance(buildSignals({ headers: {} })), "Compression").passed).toBe(false);
  });

  it("passes Caching from Cache-Control, ETag, or Expires", () => {
    expect(findingFor(analyzePerformance(buildSignals({ headers: { "cache-control": "max-age=3600" } })), "Caching").passed).toBe(true);
    expect(findingFor(analyzePerformance(buildSignals({ headers: { etag: '"abc123"' } })), "Caching").passed).toBe(true);
    expect(findingFor(analyzePerformance(buildSignals({ headers: {} })), "Caching").passed).toBe(false);
  });

  it("passes the resource-hints CWV indicator from preconnect/dns-prefetch/preload links", () => {
    const result = analyzePerformance(buildSignals({ html: '<link rel="preconnect" href="https://fonts.gstatic.com">' }));
    expect(findingFor(result, "Core Web Vitals Indicator: Resource Hints").passed).toBe(true);
  });

  it("only reports the font-loading-strategy indicator when web fonts are actually used", () => {
    const noFonts = analyzePerformance(buildSignals({ html: "<html></html>" }));
    expect(noFonts.findings.some((f) => f.check === "Core Web Vitals Indicator: Font Loading Strategy")).toBe(false);

    const withFonts = analyzePerformance(buildSignals({ html: '<link href="https://fonts.googleapis.com/css?family=Roboto">' }));
    expect(withFonts.findings.some((f) => f.check === "Core Web Vitals Indicator: Font Loading Strategy")).toBe(true);
    expect(findingFor(withFonts, "Core Web Vitals Indicator: Font Loading Strategy").passed).toBe(false);

    const withSwap = analyzePerformance(buildSignals({ html: "<style>@font-face{font-family:'X';font-display:swap;}</style>" }));
    expect(findingFor(withSwap, "Core Web Vitals Indicator: Font Loading Strategy").passed).toBe(true);
  });

  it("passes Asset Minification when at least half of script/stylesheet assets use .min.", () => {
    const result = analyzePerformance(
      buildSignals({
        scripts: [{ src: "/app.min.js", inline: null }, { src: "/vendor.js", inline: null }],
        linkTags: [{ rel: "stylesheet", href: "/styles.min.css", as: null }],
      })
    );
    expect(findingFor(result, "Asset Minification").passed).toBe(true);
  });

  it("produces a 0-100 score, perfect for a fully-optimized synthetic page", () => {
    const result = analyzePerformance(
      buildSignals({
        html: '<img src="a.webp" width="10" height="10" loading="lazy"><link rel="preconnect" href="https://example.com">',
        headers: { "content-encoding": "br", "cache-control": "max-age=31536000" },
        scripts: [{ src: "/app.min.js", inline: null }],
      })
    );
    expect(result.score).toBe(100);
  });

  it("produces a low score for a completely unoptimized page", () => {
    const result = analyzePerformance(buildSignals({ html: '<img src="a.jpg">', headers: {}, scripts: [{ src: "/app.js", inline: null }] }));
    expect(result.score).toBeLessThan(40);
  });
});

describe("analyzePerformance — real websites", () => {
  it("correctly detects real Brotli compression once Accept-Encoding is negotiated — real bug found: undici doesn't request compression by default, and doesn't auto-decompress once it's requested", async () => {
    const signals = await collectSignals("https://books.toscrape.com");
    expect(signals.headers["content-encoding"]).toBe("br");
    expect(signals.html).toContain("<html");
    const result = analyzePerformance(signals);
    expect(findingFor(result, "Compression").passed).toBe(true);
  }, 30000);
});
