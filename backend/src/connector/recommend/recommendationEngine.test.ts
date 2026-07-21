import { describe, it, expect } from "vitest";
import { recommendConnector, listSupportedConnectorTypes } from "./recommendationEngine";
import type { TechnologyReportSignal } from "../types";

function fixture(overrides: Partial<TechnologyReportSignal> = {}): TechnologyReportSignal {
  return {
    websiteUrl: "https://example.com",
    cms: [],
    backendFrameworks: [],
    frontendFrameworks: [],
    authentication: [],
    smartConnectorCompatibility: { compatible: true, recommendedConnectors: [], notes: [] },
    ...overrides,
  };
}

describe("recommendConnector", () => {
  it("recommends the WooCommerce connector for a confident WooCommerce CMS detection", () => {
    const report = fixture({ cms: [{ name: "WooCommerce", confidence: 0.9, evidence: ["wp-json/wc/v3 route found"] }] });
    const rec = recommendConnector(report);
    expect(rec.connectorType).toBe("WOOCOMMERCE");
    expect(rec.confidence).toBe(0.9);
    expect(rec.reasons.some((r) => r.includes("WooCommerce"))).toBe(true);
  });

  it("falls back to backend framework when CMS confidence is low", () => {
    const report = fixture({
      cms: [{ name: "WordPress", confidence: 0.1, evidence: [] }],
      backendFrameworks: [{ name: "Laravel", confidence: 0.8, evidence: ["X-Powered-By: Laravel"] }],
    });
    const rec = recommendConnector(report);
    expect(rec.connectorType).toBe("LARAVEL");
  });

  it("falls back to Universal REST when nothing matches at sufficient confidence", () => {
    const report = fixture({ cms: [{ name: "Unknown", confidence: 0.05, evidence: [] }] });
    const rec = recommendConnector(report);
    expect(rec.connectorType).toBe("UNIVERSAL_REST");
    expect(rec.confidence).toBeLessThan(0.5);
  });

  it("refines auth method to OAUTH2 when authentication signal detects OAuth", () => {
    const report = fixture({
      cms: [{ name: "Shopify", confidence: 0.85, evidence: [] }],
      authentication: [{ name: "OAuth 2.0 login", confidence: 0.7, evidence: ["oauth callback URL found"] }],
    });
    const rec = recommendConnector(report);
    expect(rec.authMethod).toBe("OAUTH2");
  });

  it("keeps the connector's default auth method when no strong auth signal exists", () => {
    const report = fixture({ cms: [{ name: "WordPress", confidence: 0.9, evidence: [] }] });
    const rec = recommendConnector(report);
    expect(rec.authMethod).toBe("NONE");
  });

  it("uses the top-confidence candidate when multiple CMS candidates are present", () => {
    const report = fixture({
      cms: [
        { name: "Magento", confidence: 0.3, evidence: [] },
        { name: "Shopify", confidence: 0.95, evidence: [] },
      ],
    });
    const rec = recommendConnector(report);
    expect(rec.connectorType).toBe("SHOPIFY");
  });

  it("includes Phase 4's own recommendedConnectors in the reasons for transparency", () => {
    const report = fixture({
      cms: [{ name: "Shopify", confidence: 0.8, evidence: [] }],
      smartConnectorCompatibility: { compatible: true, recommendedConnectors: ["Shopify Admin API Connector"], notes: [] },
    });
    const rec = recommendConnector(report);
    expect(rec.reasons.some((r) => r.includes("Shopify Admin API Connector"))).toBe(true);
  });

  it("baseUrl always comes from the report's websiteUrl", () => {
    const report = fixture({ websiteUrl: "https://mystore.example" });
    expect(recommendConnector(report).baseUrl).toBe("https://mystore.example");
  });
});

describe("listSupportedConnectorTypes", () => {
  it("returns every registered connector type with its supported auth methods", () => {
    const list = listSupportedConnectorTypes();
    expect(list.length).toBeGreaterThan(5);
    expect(list.every((c) => c.supportedAuthMethods.length > 0)).toBe(true);
  });
});
