import { describe, it, expect } from "vitest";
import { validateEndpoint, validateEndpoints } from "./apiValidationEngine";
import { DEFAULT_CONNECTOR_CONFIG } from "../types";
import type { DiscoveredEndpoint } from "../types";

const NONE_CRED = { authMethod: "NONE" as const };

describe("validateEndpoint — real network", () => {
  it("validates a real, working JSON endpoint (Shopify products.json)", async () => {
    const endpoint: DiscoveredEndpoint = { category: "products", path: "/products.json", method: "GET", discoveredVia: "known-pattern" };
    const result = await validateEndpoint(endpoint, {
      connectorId: `test-validate-shopify-${Date.now()}`,
      baseUrl: "https://www.allbirds.com",
      credential: NONE_CRED,
      config: DEFAULT_CONNECTOR_CONFIG,
    });
    expect(result.validated).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.responseSample).toBeTruthy();
    expect((result.responseSample as { products: unknown[] }).products).toBeDefined();
  }, 20_000);

  it("marks a genuinely non-existent endpoint as not validated with a clear error", async () => {
    const endpoint: DiscoveredEndpoint = { category: "custom", path: "/this-path-genuinely-does-not-exist-kvl-test", method: "GET", discoveredVia: "manual" };
    const result = await validateEndpoint(endpoint, {
      connectorId: `test-validate-404-${Date.now()}`,
      baseUrl: "https://wptavern.com",
      credential: NONE_CRED,
      config: DEFAULT_CONNECTOR_CONFIG,
    });
    expect(result.validated).toBe(false);
    expect(result.errorMessage).toBeTruthy();
  }, 20_000);

  it("marks an HTML (non-JSON) response as not validated", async () => {
    const endpoint: DiscoveredEndpoint = { category: "custom", path: "/", method: "GET", discoveredVia: "manual" };
    const result = await validateEndpoint(endpoint, {
      connectorId: `test-validate-html-${Date.now()}`,
      baseUrl: "https://wptavern.com",
      credential: NONE_CRED,
      config: DEFAULT_CONNECTOR_CONFIG,
    });
    expect(result.validated).toBe(false);
    expect(result.errorMessage).toMatch(/not JSON/);
  }, 20_000);

  it("validates a real GraphQL introspection query end-to-end", async () => {
    const endpoint: DiscoveredEndpoint = {
      category: "custom",
      path: "/graphql",
      method: "POST",
      discoveredVia: "graphql-introspection",
      graphqlQuery: "query IntrospectionProbe { __schema { queryType { name } } }",
    };
    const result = await validateEndpoint(endpoint, {
      connectorId: `test-validate-graphql-${Date.now()}`,
      baseUrl: "https://countries.trevorblades.com",
      credential: NONE_CRED,
      config: DEFAULT_CONNECTOR_CONFIG,
    });
    expect(result.validated).toBe(true);
  }, 20_000);

  it("validateEndpoints processes a mixed batch and returns one result per input, preserving order", async () => {
    const endpoints: DiscoveredEndpoint[] = [
      { category: "products", path: "/products.json", method: "GET", discoveredVia: "known-pattern" },
      { category: "custom", path: "/definitely-missing-kvl-test", method: "GET", discoveredVia: "manual" },
    ];
    const results = await validateEndpoints(endpoints, {
      connectorId: `test-validate-batch-${Date.now()}`,
      baseUrl: "https://www.allbirds.com",
      credential: NONE_CRED,
      config: DEFAULT_CONNECTOR_CONFIG,
    });
    expect(results).toHaveLength(2);
    expect(results[0].validated).toBe(true);
    expect(results[1].validated).toBe(false);
  }, 20_000);
});
