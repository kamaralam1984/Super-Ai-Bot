import { describe, it, expect } from "vitest";
import { CONNECTOR_DEFINITIONS, getConnectorDefinition, findDefinitionForPlatform } from "./connectorRegistry";

describe("connectorRegistry", () => {
  it("every definition has at least one supported auth method that includes its default", () => {
    for (const def of CONNECTOR_DEFINITIONS) {
      expect(def.supportedAuthMethods).toContain(def.defaultAuthMethod);
    }
  });

  it("getConnectorDefinition returns the matching definition", () => {
    expect(getConnectorDefinition("SHOPIFY").displayName).toBe("Shopify Connector");
  });

  it("getConnectorDefinition throws for an unknown type", () => {
    expect(() => getConnectorDefinition("NOT_REAL" as never)).toThrow();
  });

  it("findDefinitionForPlatform maps WordPress to the WordPress connector", () => {
    expect(findDefinitionForPlatform("WordPress")?.connectorType).toBe("WORDPRESS");
  });

  it("findDefinitionForPlatform maps WooCommerce to the WooCommerce connector, not the generic WordPress one", () => {
    expect(findDefinitionForPlatform("WooCommerce")?.connectorType).toBe("WOOCOMMERCE");
  });

  it("findDefinitionForPlatform maps a framework name to the REST connector", () => {
    expect(findDefinitionForPlatform("FastAPI")?.connectorType).toBe("GENERIC_REST");
    expect(findDefinitionForPlatform("Spring Boot")?.connectorType).toBe("GENERIC_REST");
  });

  it("findDefinitionForPlatform maps enterprise system categories to the Universal REST connector", () => {
    expect(findDefinitionForPlatform("ERP")?.connectorType).toBe("UNIVERSAL_REST");
    expect(findDefinitionForPlatform("CRM")?.connectorType).toBe("UNIVERSAL_REST");
  });

  it("findDefinitionForPlatform returns null for a completely unknown platform", () => {
    expect(findDefinitionForPlatform("SomeRandomPlatformNoOneUses")).toBeNull();
  });

  it("no two connector definitions claim the same platform name", () => {
    const seen = new Map<string, string>();
    for (const def of CONNECTOR_DEFINITIONS) {
      for (const platform of def.matchesPlatforms) {
        expect(seen.has(platform)).toBe(false);
        seen.set(platform, def.connectorType);
      }
    }
  });

  it("WooCommerce's known endpoints are a superset that includes WordPress's core endpoints (it's WordPress + WooCommerce)", () => {
    const woo = getConnectorDefinition("WOOCOMMERCE");
    const wp = getConnectorDefinition("WORDPRESS");
    for (const wpEndpoint of wp.knownEndpoints) {
      expect(woo.knownEndpoints.some((e) => e.path === wpEndpoint.path)).toBe(true);
    }
  });

  it("GraphQL connector's known endpoints are all POST, discovered via introspection", () => {
    const gql = getConnectorDefinition("GENERIC_GRAPHQL");
    expect(gql.knownEndpoints.every((e) => e.method === "POST" && e.discoveredVia === "graphql-introspection")).toBe(true);
  });

  it("SOAP_API, GRPC_API, and XML_API are registered with no known REST-style endpoints (least-privilege is enforced elsewhere for SOAP/gRPC)", () => {
    for (const type of ["SOAP_API", "GRPC_API", "XML_API"] as const) {
      const def = getConnectorDefinition(type);
      expect(def.knownEndpoints).toEqual([]);
      expect(def.supportedAuthMethods.length).toBeGreaterThan(0);
    }
  });

  it("SOAP and gRPC connectors both support MTLS", () => {
    expect(getConnectorDefinition("SOAP_API").supportedAuthMethods).toContain("MTLS");
    expect(getConnectorDefinition("GRPC_API").supportedAuthMethods).toContain("MTLS");
  });
});
