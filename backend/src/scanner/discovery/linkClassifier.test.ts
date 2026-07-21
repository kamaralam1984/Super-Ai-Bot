import { describe, it, expect } from "vitest";
import { classifyLink, normalizeUrl } from "./linkClassifier";

const BASE = "https://example.com";

describe("classifyLink", () => {
  it("classifies same-domain links as internal", () => {
    expect(classifyLink("https://example.com/about", BASE)).toBe("internal");
    expect(classifyLink("/contact", BASE)).toBe("internal");
    expect(classifyLink("https://www.example.com/blog", "https://example.com")).toBe("internal");
  });

  it("classifies other domains as external", () => {
    expect(classifyLink("https://some-other-site.com/page", BASE)).toBe("external");
  });

  it("classifies known social platforms", () => {
    expect(classifyLink("https://facebook.com/acme", BASE)).toBe("social");
    expect(classifyLink("https://www.youtube.com/watch?v=abc", BASE)).toBe("social");
    expect(classifyLink("https://wa.me/1234567890", BASE)).toBe("social");
  });

  it("classifies known CDN domains", () => {
    expect(classifyLink("https://cdnjs.cloudflare.com/ajax/libs/jquery.js", BASE)).toBe("cdn");
  });

  it("classifies known ad/tracking domains", () => {
    expect(classifyLink("https://www.google-analytics.com/analytics.js", BASE)).toBe("tracking");
    expect(classifyLink("https://doubleclick.net/pixel", BASE)).toBe("tracking");
  });

  it("classifies static asset extensions", () => {
    expect(classifyLink("/assets/style.css", BASE)).toBe("asset");
    expect(classifyLink("/assets/app.js", BASE)).toBe("asset");
  });

  it("resolves a bare relative path against the base as internal", () => {
    // WHATWG URL treats a plain string as a relative reference when a base
    // is given — "not a url at all" is a valid (if unusual) relative path.
    expect(classifyLink("not a url at all", BASE)).toBe("internal");
  });

  it("treats a genuinely unparseable URL as external rather than throwing", () => {
    expect(classifyLink("http://[::1", BASE)).toBe("external");
  });
});

describe("normalizeUrl", () => {
  it("strips fragments", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("strips trailing slashes except root", () => {
    expect(normalizeUrl("https://example.com/page/")).toBe("https://example.com/page");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });
});
