import { describe, it, expect } from "vitest";
import { generateTechnologyReport, type TechnologyReportInput } from "./reportGenerator";
import type { ScoredCandidate } from "../types";
import type { SecurityAnalysisResult } from "../security/securityAnalyzer";
import type { PerformanceAnalysisResult } from "../performance/performanceAnalyzer";

function candidate(name: string, confidence: number): ScoredCandidate {
  return { name, confidence, evidence: [`evidence for ${name}`] };
}

const GOOD_SECURITY: SecurityAnalysisResult = { findings: [{ check: "HTTPS", passed: true, severity: "critical", detail: "ok" }], score: 90 };
const GOOD_PERFORMANCE: PerformanceAnalysisResult = { findings: [{ check: "Caching", passed: true, severity: "high", detail: "ok" }], score: 90 };

function baseInput(overrides: Partial<TechnologyReportInput> = {}): TechnologyReportInput {
  return {
    websiteUrl: "https://example.test",
    cms: [],
    frontendFrameworks: [],
    backendFrameworks: [],
    programmingLanguages: [],
    hosting: [],
    server: [],
    cdn: [],
    database: [],
    jsLibraries: [],
    cssFrameworks: [],
    seoTools: [],
    analytics: [],
    paymentGateways: [],
    authentication: [],
    liveChat: [],
    forms: [],
    security: GOOD_SECURITY,
    performance: GOOD_PERFORMANCE,
    ...overrides,
  };
}

describe("generateTechnologyReport — overallConfidence", () => {
  it("averages the top candidate's confidence across every populated category", () => {
    const report = generateTechnologyReport(baseInput({ cms: [candidate("WordPress", 0.9)], hosting: [candidate("AWS", 0.5)] }));
    expect(report.overallConfidence).toBeCloseTo(0.7, 5);
  });

  it("is 0 when nothing was detected in any category", () => {
    const report = generateTechnologyReport(baseInput());
    expect(report.overallConfidence).toBe(0);
  });

  it("only counts each category's top candidate, not every candidate in it", () => {
    const report = generateTechnologyReport(baseInput({ cms: [candidate("WordPress", 0.9), candidate("WooCommerce", 0.3)] }));
    expect(report.overallConfidence).toBeCloseTo(0.9, 5);
  });
});

describe("generateTechnologyReport — recommendations", () => {
  it("recommends improving security when the score is weak", () => {
    const report = generateTechnologyReport(baseInput({ security: { findings: [], score: 30 } }));
    expect(report.recommendations.some((r) => /security posture is weak/i.test(r))).toBe(true);
  });

  it("recommends closing header gaps for a middling security score", () => {
    const report = generateTechnologyReport(baseInput({ security: { findings: [], score: 65 } }));
    expect(report.recommendations.some((r) => /some security headers are missing/i.test(r))).toBe(true);
  });

  it("recommends performance improvements when the score is poor", () => {
    const report = generateTechnologyReport(baseInput({ performance: { findings: [], score: 20 } }));
    expect(report.recommendations.some((r) => /page performance is poor/i.test(r))).toBe(true);
  });

  it("recommends manual review when nothing is confidently detected", () => {
    const report = generateTechnologyReport(baseInput());
    expect(report.recommendations.some((r) => /custom-built site/i.test(r))).toBe(true);
  });

  it("recommends the WordPress REST API path when WordPress is detected with high confidence", () => {
    const report = generateTechnologyReport(baseInput({ cms: [candidate("WordPress", 0.9)] }));
    expect(report.recommendations.some((r) => /WordPress REST API/i.test(r))).toBe(true);
  });

  it("recommends the Shopify API path when Shopify is detected with high confidence", () => {
    const report = generateTechnologyReport(baseInput({ cms: [candidate("Shopify", 0.85)] }));
    expect(report.recommendations.some((r) => /Shopify Admin\/Storefront API/i.test(r))).toBe(true);
  });

  it("surfaces an existing payment gateway as a recommendation", () => {
    const report = generateTechnologyReport(baseInput({ paymentGateways: [candidate("Stripe", 0.9)] }));
    expect(report.recommendations.some((r) => /Stripe/.test(r))).toBe(true);
  });

  it("notes a real existing live chat widget so it isn't silently duplicated", () => {
    const report = generateTechnologyReport(baseInput({ liveChat: [candidate("Intercom", 0.9)] }));
    expect(report.recommendations.some((r) => /Intercom/.test(r) && /replace it or run alongside/i.test(r))).toBe(true);
  });

  it("notes when no live chat widget exists at all", () => {
    const report = generateTechnologyReport(baseInput());
    expect(report.recommendations.some((r) => /no existing live chat/i.test(r))).toBe(true);
  });

  it("recommends matching cookie security standards when existing cookies are insecure", () => {
    const report = generateTechnologyReport(
      baseInput({ security: { findings: [{ check: "Cookie Policy", passed: false, severity: "medium", detail: "insecure" }], score: 70 } })
    );
    expect(report.recommendations.some((r) => /secure\/httponly/i.test(r))).toBe(true);
  });
});

describe("generateTechnologyReport — Smart Connector compatibility", () => {
  it("is always marked compatible, since the widget is a universal script embed", () => {
    const report = generateTechnologyReport(baseInput());
    expect(report.smartConnectorCompatibility.compatible).toBe(true);
  });

  it("always includes the generic JavaScript embed connector as a universal fallback", () => {
    const report = generateTechnologyReport(baseInput());
    expect(report.smartConnectorCompatibility.recommendedConnectors).toContain("Generic JavaScript Embed Connector");
  });

  it("recommends the WordPress connector when WordPress is confidently detected", () => {
    const report = generateTechnologyReport(baseInput({ cms: [candidate("WordPress", 0.9)] }));
    expect(report.smartConnectorCompatibility.recommendedConnectors).toContain("WordPress REST API Connector");
  });

  it("recommends both WordPress and WooCommerce connectors when both are detected", () => {
    const report = generateTechnologyReport(baseInput({ cms: [candidate("WordPress", 0.9), candidate("WooCommerce", 0.8)] }));
    const connectors = report.smartConnectorCompatibility.recommendedConnectors;
    expect(connectors).toContain("WordPress REST API Connector");
    expect(connectors).toContain("WooCommerce Order/Product Connector");
  });

  it("does not recommend a CMS connector for a low-confidence match", () => {
    const report = generateTechnologyReport(baseInput({ cms: [candidate("WordPress", 0.1)] }));
    expect(report.smartConnectorCompatibility.recommendedConnectors).not.toContain("WordPress REST API Connector");
  });

  it("recommends a custom API connector naming the detected backend framework", () => {
    const report = generateTechnologyReport(baseInput({ backendFrameworks: [candidate("Django", 0.8)] }));
    expect(report.smartConnectorCompatibility.recommendedConnectors).toContain("Custom API Connector (backend: Django)");
  });

  it("does not recommend a custom backend connector for the Custom Backend fallback candidate itself", () => {
    const report = generateTechnologyReport(baseInput({ backendFrameworks: [candidate("Custom Backend", 0.25)] }));
    expect(report.smartConnectorCompatibility.recommendedConnectors.some((c) => c.startsWith("Custom API Connector"))).toBe(false);
  });
});
