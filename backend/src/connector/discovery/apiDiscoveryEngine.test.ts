import { describe, it, expect } from "vitest";
import { discoverEndpoints } from "./apiDiscoveryEngine";
import { validateEndpoints } from "../validation/apiValidationEngine";
import { DEFAULT_CONNECTOR_CONFIG } from "../types";

const NONE_CRED = { authMethod: "NONE" as const };

describe("discoverEndpoints — real network", () => {
  it("discovers real known-pattern endpoints on a real, live Shopify store", async () => {
    const result = await discoverEndpoints({
      connectorId: `test-discover-shopify-${Date.now()}`,
      connectorType: "SHOPIFY",
      baseUrl: "https://www.allbirds.com",
      credential: NONE_CRED,
      config: DEFAULT_CONNECTOR_CONFIG,
    });
    expect(result.discovered.some((e) => e.path === "/products.json")).toBe(true);
    expect(result.probedPaths.length).toBeGreaterThan(0);
  }, 30_000);

  it("discovers real known-pattern endpoints on a real, live WordPress site", async () => {
    const result = await discoverEndpoints({
      connectorId: `test-discover-wp-${Date.now()}`,
      connectorType: "WORDPRESS",
      baseUrl: "https://wptavern.com",
      credential: NONE_CRED,
      config: DEFAULT_CONNECTOR_CONFIG,
    });
    expect(result.discovered.some((e) => e.path === "/wp-json/wp/v2/posts")).toBe(true);
  }, 30_000);

  it("finds a real OpenAPI spec and extracts real GET endpoints from it (Swagger Petstore)", async () => {
    const result = await discoverEndpoints({
      connectorId: `test-discover-openapi-${Date.now()}`,
      connectorType: "UNIVERSAL_REST",
      baseUrl: "https://petstore3.swagger.io",
      credential: NONE_CRED,
      config: DEFAULT_CONNECTOR_CONFIG,
    });
    expect(result.openApiSpecFound).toBe(true);
    expect(result.discovered.length).toBeGreaterThan(0);
    expect(result.discovered.every((e) => e.method === "GET")).toBe(true);
  }, 30_000);

  it("finds a real GraphQL endpoint via introspection on a real public GraphQL API", async () => {
    const result = await discoverEndpoints({
      connectorId: `test-discover-graphql-${Date.now()}`,
      connectorType: "GENERIC_GRAPHQL",
      baseUrl: "https://countries.trevorblades.com",
      credential: NONE_CRED,
      config: DEFAULT_CONNECTOR_CONFIG,
    });
    expect(result.graphqlEndpointFound).toBe(true);
    expect(result.discovered.some((e) => e.path === "/graphql")).toBe(true);
  }, 30_000);

  it("filters out known-pattern endpoints that genuinely 404 on a real site (Magento paths probed against a real WordPress site)", async () => {
    const result = await discoverEndpoints({
      connectorId: `test-discover-none-${Date.now()}`,
      connectorType: "MAGENTO",
      baseUrl: "https://wptavern.com", // a real, reachable WordPress site — has none of Magento's REST paths, confirmed 404 via curl
      credential: NONE_CRED,
      config: DEFAULT_CONNECTOR_CONFIG,
    });
    expect(result.discovered.filter((e) => e.discoveredVia === "known-pattern")).toHaveLength(0);
  }, 30_000);

  // Regression: discovery (5 known-pattern + up to 5 OpenAPI probe calls)
  // followed immediately by validation (one call per discovered endpoint)
  // easily exceeds a steady-state per-connector rate limit sized for
  // ongoing AI-tool traffic, silently dropping real endpoints with no
  // trace — caught by real-world testing against a live Shopify store,
  // where discovery intermittently returned 3-4 of the 5 known endpoints
  // instead of 5 depending on request timing. The fix (connectorOrchestrator
  // .service.ts) runs setup scanning under its own generous, isolated rate
  // limit rather than the connector's real runtime one. This test verifies
  // that generous budget is what makes the full scan reliable.
  it("discovers and validates all 5 real Shopify known-pattern endpoints when given a scan-sized rate-limit budget (regression for setup-time self-throttling)", async () => {
    const connectorId = `test-discover-scan-budget-${Date.now()}`;
    const generousConfig = { ...DEFAULT_CONNECTOR_CONFIG, rateLimit: { maxTokens: 50, refillPerSecond: 10 } };

    const discovery = await discoverEndpoints({
      connectorId,
      connectorType: "SHOPIFY",
      baseUrl: "https://www.allbirds.com",
      credential: NONE_CRED,
      config: generousConfig,
    });
    expect(discovery.discovered).toHaveLength(5);

    const validated = await validateEndpoints(discovery.discovered, {
      connectorId,
      baseUrl: "https://www.allbirds.com",
      credential: NONE_CRED,
      config: generousConfig,
    });
    expect(validated).toHaveLength(5);
    expect(validated.filter((e) => e.validated).map((e) => e.path)).toEqual(expect.arrayContaining(["/products.json", "/collections.json"]));
  }, 30_000);
});
