import { describe, it, expect } from "vitest";
import { detectTechStack } from "./techStack";

describe("detectTechStack", () => {
  it("detects WordPress from wp-content references", () => {
    const html = `<html><head><link rel="stylesheet" href="/wp-content/themes/twentytwentyone/style.css"></head><body></body></html>`;
    const result = detectTechStack(html, {});
    expect(result.cms).toBe("WordPress");
  });

  it("detects WooCommerce alongside WordPress", () => {
    const html = `<html><body class="woocommerce woocommerce-page"><div class="wp-content"></div></body></html>`;
    const result = detectTechStack(html, {});
    expect(result.ecommerce).toBe("WooCommerce");
  });

  it("detects Shopify from CDN reference", () => {
    const html = `<html><head><script src="https://cdn.shopify.com/s/files/1/theme.js"></script></head></html>`;
    const result = detectTechStack(html, {});
    expect(result.cms).toBe("Shopify");
    expect(result.ecommerce).toBe("Shopify");
  });

  it("detects Next.js from __NEXT_DATA__", () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">{}</script></body></html>`;
    const result = detectTechStack(html, {});
    expect(result.frameworks).toContain("Next.js");
  });

  it("detects Angular from ng-version attribute", () => {
    const html = `<html><body><app-root ng-version="17.0.0"></app-root></body></html>`;
    const result = detectTechStack(html, {});
    expect(result.frameworks).toContain("Angular");
  });

  it("detects Laravel from session cookie header", () => {
    const html = `<html></html>`;
    const result = detectTechStack(html, { "set-cookie": "laravel_session=abc123; Path=/" });
    expect(result.frameworks).toContain("Laravel");
  });

  it("returns low confidence with no signals present", () => {
    const html = `<html><body><h1>Plain static page</h1></body></html>`;
    const result = detectTechStack(html, {});
    expect(result.cms).toBeNull();
    expect(result.frameworks).toEqual([]);
    expect(result.confidence).toBe("low");
  });
});
