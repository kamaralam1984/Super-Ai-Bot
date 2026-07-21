import { describe, it, expect } from "vitest";
import { classifyPageType } from "./pageTypeClassifier";

describe("classifyPageType", () => {
  it("classifies common page types from URL path", () => {
    expect(classifyPageType("https://acme.com/", null)).toBe("home");
    expect(classifyPageType("https://acme.com/about-us", null)).toBe("about");
    expect(classifyPageType("https://acme.com/shop/widgets", null)).toBe("product");
    expect(classifyPageType("https://acme.com/blog/2024/hello", null)).toBe("blog");
    expect(classifyPageType("https://acme.com/faq", null)).toBe("faq");
    expect(classifyPageType("https://acme.com/contact-us", null)).toBe("contact");
    expect(classifyPageType("https://acme.com/privacy-policy", null)).toBe("policy");
  });

  it("falls back to title-based classification when the URL doesn't match", () => {
    expect(classifyPageType("https://acme.com/p?id=42", "Frequently Asked Questions")).toBe("faq");
  });

  it("returns 'other' when nothing matches", () => {
    expect(classifyPageType("https://acme.com/xyz123", "Random Page")).toBe("other");
  });

  it("handles malformed URLs gracefully via title fallback", () => {
    expect(classifyPageType("not a url", "Contact Us")).toBe("contact");
  });
});
