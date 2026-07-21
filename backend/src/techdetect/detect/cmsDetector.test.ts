import { describe, it, expect } from "vitest";
import { detectCms } from "./cmsDetector";
import { buildSignals } from "../testFixtures";
import { collectSignals } from "../signals/signalCollector";

function namesOf(result: ReturnType<typeof detectCms>): string[] {
  return result.map((c) => c.name);
}

describe("detectCms — synthetic signatures", () => {
  it("detects WordPress from wp-content/wp-includes paths", () => {
    const signals = buildSignals({ html: '<html><body><link href="/wp-content/themes/twentytwenty/style.css"><script src="/wp-includes/js/jquery.js"></script></body></html>' });
    expect(namesOf(detectCms(signals))).toContain("WordPress");
  });

  it("detects WordPress from the generator meta tag", () => {
    const signals = buildSignals({ metaTags: [{ name: "generator", property: null, content: "WordPress 6.4" }] });
    expect(namesOf(detectCms(signals))).toContain("WordPress");
  });

  it("does not flag WooCommerce from incidental prose mentioning the word", () => {
    // Real bug found testing against wptavern.com (a WordPress news blog
    // that writes about WooCommerce but doesn't run it) — a bare substring
    // match on "woocommerce" anywhere in the page false-positived.
    const signals = buildSignals({ html: "<html><body><p>Read our review of WooCommerce plugins for 2026.</p></body></html>" });
    expect(namesOf(detectCms(signals))).not.toContain("WooCommerce");
  });

  it("detects WooCommerce from real plugin markup", () => {
    const signals = buildSignals({ html: '<html><body class="woocommerce woocommerce-page"><script src="/wp-content/plugins/woocommerce/assets/js/frontend/woocommerce.min.js"></script></body></html>' });
    expect(namesOf(detectCms(signals))).toContain("WooCommerce");
  });

  it("detects Shopify from cdn.shopify.com and storefront cookies", () => {
    const signals = buildSignals({
      html: '<script src="https://cdn.shopify.com/s/files/1/theme.js"></script>',
      cookies: ["_shopify_s=abc123", "cart_currency=USD"],
    });
    expect(namesOf(detectCms(signals))).toContain("Shopify");
  });

  it("detects Shopify from the X-ShopId header alone", () => {
    const signals = buildSignals({ headers: { "x-shopid": "12345" } });
    expect(namesOf(detectCms(signals))).toContain("Shopify");
  });

  it("detects Shopify from the /products.json well-known probe", () => {
    const signals = buildSignals({ wellKnownProbes: [{ path: "/products.json", found: true, statusCode: 200 }] });
    expect(namesOf(detectCms(signals))).toContain("Shopify");
  });

  it("detects Magento from Mage.Cookies and X-Magento headers", () => {
    const signals = buildSignals({ html: "<script>Mage.Cookies.set('x','y')</script>", headers: { "x-magento-cache-debug": "HIT" } });
    expect(namesOf(detectCms(signals))).toContain("Magento");
  });

  it("detects OpenCart from OCSESSID cookie and route= URLs", () => {
    const signals = buildSignals({ html: '<a href="index.php?route=product/product&product_id=42">Buy</a>', cookies: ["OCSESSID=abc123"] });
    expect(namesOf(detectCms(signals))).toContain("OpenCart");
  });

  it("detects PrestaShop from generator tag and session cookie", () => {
    const signals = buildSignals({ metaTags: [{ name: "generator", property: null, content: "PrestaShop" }], cookies: ["PrestaShop-abc123=xyz"] });
    expect(namesOf(detectCms(signals))).toContain("PrestaShop");
  });

  it("detects Drupal from the generator meta tag and settings object", () => {
    const signals = buildSignals({ metaTags: [{ name: "generator", property: null, content: "Drupal 10" }], html: "<script>Drupal.settings = {};</script>" });
    expect(namesOf(detectCms(signals))).toContain("Drupal");
  });

  it("detects Joomla from generator tag and session cookie", () => {
    const signals = buildSignals({
      metaTags: [{ name: "generator", property: null, content: "Joomla! - Open Source Content Management" }],
      cookies: ["joomla_user_state=logged_in"],
    });
    expect(namesOf(detectCms(signals))).toContain("Joomla");
  });

  it("detects Ghost from the generator meta tag", () => {
    const signals = buildSignals({ metaTags: [{ name: "generator", property: null, content: "Ghost 5.42" }] });
    expect(namesOf(detectCms(signals))).toContain("Ghost");
  });

  it("detects Blogger from blogspot.com URLs", () => {
    const signals = buildSignals({ html: '<link rel="canonical" href="https://myblog.blogspot.com/2026/01/post.html">' });
    expect(namesOf(detectCms(signals))).toContain("Blogger");
  });

  it("detects Wix from static asset domains and request-id header", () => {
    const signals = buildSignals({ html: '<script src="https://static.wixstatic.com/bundle.js"></script>', headers: { "x-wix-request-id": "abc" } });
    expect(namesOf(detectCms(signals))).toContain("Wix");
  });

  it("detects Squarespace from static asset domain", () => {
    const signals = buildSignals({ html: '<script src="https://static1.squarespace.com/static/abc/main.js"></script>' });
    expect(namesOf(detectCms(signals))).toContain("Squarespace");
  });

  it("detects Webflow from data-wf attributes and generator tag", () => {
    const signals = buildSignals({
      html: '<html data-wf-site="abc123" data-wf-page="def456">',
      metaTags: [{ name: "generator", property: null, content: "Webflow" }],
    });
    expect(namesOf(detectCms(signals))).toContain("Webflow");
  });

  it("falls back to a low-confidence Custom CMS candidate when nothing matches but the page has real HTML", () => {
    const signals = buildSignals({ html: "<html><body><h1>Just a plain custom site</h1></body></html>" });
    const result = detectCms(signals);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Custom CMS");
    expect(result[0].matches[0].weight).toBeLessThan(0.5);
  });

  it("returns no candidates at all for genuinely empty input", () => {
    const signals = buildSignals({ html: "" });
    expect(detectCms(signals)).toEqual([]);
  });

  it("returns multiple independent candidates when signals for more than one platform are present (e.g. a WordPress+WooCommerce store)", () => {
    const signals = buildSignals({
      html: '<html><body class="woocommerce"><link href="/wp-content/themes/x/style.css"></body></html>',
      metaTags: [{ name: "generator", property: null, content: "WordPress 6.4" }],
    });
    const names = namesOf(detectCms(signals));
    expect(names).toContain("WordPress");
    expect(names).toContain("WooCommerce");
  });
});

describe("detectCms — real websites", () => {
  it("detects WordPress on a real, live WordPress site with strong multi-signal evidence", async () => {
    const signals = await collectSignals("https://wptavern.com");
    const result = detectCms(signals);
    const wp = result.find((c) => c.name === "WordPress");
    expect(wp).toBeDefined();
    expect(wp!.matches.length).toBeGreaterThanOrEqual(3);
  }, 30000);

  it("detects Webflow on a real, live Webflow site", async () => {
    const signals = await collectSignals("https://webflow.com");
    const result = detectCms(signals);
    expect(result.map((c) => c.name)).toContain("Webflow");
  }, 30000);
});
