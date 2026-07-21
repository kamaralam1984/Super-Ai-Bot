import { describe, it, expect } from "vitest";
import { generateConnectorReport } from "./connectorReportGenerator";
import { DEFAULT_CONNECTOR_CONFIG } from "../types";
import type { ConnectorEndpointRecord, ConnectorRecord } from "../connectorRecord.service";
import type { HealthCheckResult, SslCertificateInfo } from "../types";

const validCertFixture: SslCertificateInfo = { valid: true, issuer: "Test CA", subject: "example.com", validFrom: "2026-01-01T00:00:00Z", validTo: "2027-01-01T00:00:00Z", daysUntilExpiry: 300, selfSigned: false };

function connectorFixture(overrides: Partial<ConnectorRecord> = {}): ConnectorRecord {
  return {
    id: "conn_1",
    installationId: "inst_1",
    crawlJobId: null,
    name: "Test Connector",
    connectorType: "SHOPIFY",
    authMethod: "NONE",
    baseUrl: "https://example.com",
    status: "CONNECTED",
    priority: 0,
    config: DEFAULT_CONNECTOR_CONFIG,
    healthScore: null,
    securityScore: null,
    lastHealthCheckAt: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function endpointFixture(overrides: Partial<ConnectorEndpointRecord> = {}): ConnectorEndpointRecord {
  return {
    id: "ep_1",
    category: "products",
    path: "/products.json",
    method: "GET",
    discoveredVia: "known-pattern",
    validated: true,
    responseSample: { products: [] },
    latencyMs: 120,
    errorMessage: null,
    lastValidatedAt: new Date(),
    ...overrides,
  };
}

const healthyCheck: HealthCheckResult = { status: "CONNECTED", latencyMs: 100, availability: 1, checkedAt: new Date().toISOString() };

describe("generateConnectorReport", () => {
  it("marks a fully-validated, HTTPS, credentialed connector with a valid certificate as compatible with a perfect security score", () => {
    const report = generateConnectorReport({
      connector: connectorFixture({ authMethod: "API_KEY" }),
      endpoints: [endpointFixture()],
      recentHealthChecks: [healthyCheck],
      detectedPlatformName: "Shopify",
      sslCertificate: validCertFixture,
    });
    expect(report.compatibilityStatus).toBe("compatible");
    expect(report.securityScore).toBe(100);
    expect(report.healthScore).toBe(99); // 100ms latency isn't literally instant — computeHealthScore correctly docks a small amount even for a healthy connector
  });

  it("does not award the certificate-validity points when no SSL check was supplied", () => {
    const report = generateConnectorReport({
      connector: connectorFixture({ authMethod: "API_KEY" }),
      endpoints: [endpointFixture()],
      recentHealthChecks: [healthyCheck],
      detectedPlatformName: "Shopify",
    });
    expect(report.securityScore).toBe(90);
    expect(report.sslCertificate).toBeNull();
  });

  it("does not award the certificate-validity points for an untrusted certificate, and recommends fixing it", () => {
    const report = generateConnectorReport({
      connector: connectorFixture({ authMethod: "API_KEY" }),
      endpoints: [endpointFixture()],
      recentHealthChecks: [healthyCheck],
      detectedPlatformName: "Shopify",
      sslCertificate: { ...validCertFixture, valid: false, errorMessage: "self-signed certificate" },
    });
    expect(report.securityScore).toBe(90);
    expect(report.recommendations.some((r) => r.includes("not trusted"))).toBe(true);
  });

  it("recommends renewal for a certificate expiring soon, without failing the score outright", () => {
    const report = generateConnectorReport({
      connector: connectorFixture({ authMethod: "API_KEY" }),
      endpoints: [endpointFixture()],
      recentHealthChecks: [healthyCheck],
      detectedPlatformName: "Shopify",
      sslCertificate: { ...validCertFixture, daysUntilExpiry: 10 },
    });
    expect(report.securityScore).toBe(90);
    expect(report.recommendations.some((r) => r.includes("expires in 10 day"))).toBe(true);
  });

  it("marks a connector with zero validated endpoints as incompatible", () => {
    const report = generateConnectorReport({
      connector: connectorFixture(),
      endpoints: [endpointFixture({ validated: false, errorMessage: "HTTP 404" })],
      recentHealthChecks: [],
      detectedPlatformName: "Unknown",
    });
    expect(report.compatibilityStatus).toBe("incompatible");
    expect(report.recommendations.some((r) => r.includes("none validated"))).toBe(true);
  });

  it("marks partial validation as partial compatibility with a recommendation naming the count", () => {
    const report = generateConnectorReport({
      connector: connectorFixture(),
      endpoints: [endpointFixture({ path: "/a" }), endpointFixture({ path: "/b", validated: false, errorMessage: "HTTP 401" })],
      recentHealthChecks: [healthyCheck],
      detectedPlatformName: "Shopify",
    });
    expect(report.compatibilityStatus).toBe("partial");
    expect(report.recommendations.some((r) => r.includes("1 of 2"))).toBe(true);
  });

  it("flags plain-HTTP base URLs with a security recommendation and lower score", () => {
    const report = generateConnectorReport({
      connector: connectorFixture({ baseUrl: "http://insecure-example.com" }),
      endpoints: [endpointFixture()],
      recentHealthChecks: [healthyCheck],
      detectedPlatformName: "Custom",
    });
    expect(report.securityScore).toBeLessThan(100);
    expect(report.recommendations.some((r) => r.includes("plain HTTP"))).toBe(true);
  });

  it("falls back to the connector's stored healthScore when there's no recent check history", () => {
    const report = generateConnectorReport({
      connector: connectorFixture({ healthScore: 42 }),
      endpoints: [],
      recentHealthChecks: [],
      detectedPlatformName: "Custom",
    });
    expect(report.healthScore).toBe(42);
  });

  it("lists every endpoint's category/path/validated flag in availableApis", () => {
    const report = generateConnectorReport({
      connector: connectorFixture(),
      endpoints: [endpointFixture({ path: "/products.json", category: "products" })],
      recentHealthChecks: [healthyCheck],
      detectedPlatformName: "Shopify",
    });
    expect(report.availableApis).toEqual([{ category: "products", path: "/products.json", validated: true }]);
  });

  it("reports the latency of the most recent health check", () => {
    const report = generateConnectorReport({
      connector: connectorFixture(),
      endpoints: [endpointFixture()],
      recentHealthChecks: [{ ...healthyCheck, latencyMs: 55 }, { ...healthyCheck, latencyMs: 240 }],
      detectedPlatformName: "Shopify",
    });
    expect(report.latencyMs).toBe(240);
  });
});
