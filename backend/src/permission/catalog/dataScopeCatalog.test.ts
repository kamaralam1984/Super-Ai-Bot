import { describe, it, expect } from "vitest";
import { ALL_DATA_SCOPES } from "../types";
import { DATA_SCOPE_CATALOG, getDataScopeDefinition, listDataScopeDefinitions, scopeForChunkCategory, scopeForEndpointCategory, scopeForPolicyType } from "./dataScopeCatalog";

describe("DATA_SCOPE_CATALOG", () => {
  it("has exactly one entry per DataScope, matching its own key", () => {
    for (const scope of ALL_DATA_SCOPES) {
      expect(DATA_SCOPE_CATALOG[scope].scope).toBe(scope);
    }
    expect(Object.keys(DATA_SCOPE_CATALOG).sort()).toEqual([...ALL_DATA_SCOPES].sort());
  });

  it("every definition has a non-empty label and description", () => {
    for (const def of listDataScopeDefinitions()) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.appliesTo.length).toBeGreaterThan(0);
    }
  });

  it("marks ORDERS, CUSTOMERS, INVENTORY, APPOINTMENTS as sensitive and connector-only", () => {
    for (const scope of ["ORDERS", "CUSTOMERS", "INVENTORY", "APPOINTMENTS"] as const) {
      const def = getDataScopeDefinition(scope);
      expect(def.sensitivity).toBe("sensitive");
      expect(def.appliesTo).toEqual(["connector"]);
    }
  });
});

describe("scopeForPolicyType", () => {
  it("maps SHIPPING to its own scope", () => {
    expect(scopeForPolicyType("SHIPPING")).toBe("SHIPPING");
  });

  it("groups every other policy sub-type under SUPPORT_ARTICLES", () => {
    for (const type of ["PRIVACY", "REFUND", "CANCELLATION", "WARRANTY", "TERMS", "COOKIES", "OTHER"]) {
      expect(scopeForPolicyType(type)).toBe("SUPPORT_ARTICLES");
    }
  });

  it("falls back to SUPPORT_ARTICLES for an unrecognized policy type", () => {
    expect(scopeForPolicyType("SOMETHING_NEW")).toBe("SUPPORT_ARTICLES");
  });
});

describe("scopeForChunkCategory", () => {
  it("maps known Phase 3 categories to their scope", () => {
    expect(scopeForChunkCategory("Products")).toBe("PRODUCTS");
    expect(scopeForChunkCategory("Blogs")).toBe("BLOGS");
    expect(scopeForChunkCategory("Policies")).toBe("SUPPORT_ARTICLES");
  });

  it("returns null for general site-content categories with no dedicated toggle", () => {
    expect(scopeForChunkCategory("Company")).toBeNull();
    expect(scopeForChunkCategory("Team")).toBeNull();
  });

  it("returns null for a null category", () => {
    expect(scopeForChunkCategory(null)).toBeNull();
  });
});

describe("scopeForEndpointCategory", () => {
  it("maps every Phase 5 EndpointCategory that has a business meaning", () => {
    expect(scopeForEndpointCategory("products")).toBe("PRODUCTS");
    expect(scopeForEndpointCategory("orders")).toBe("ORDERS");
    expect(scopeForEndpointCategory("users")).toBe("CUSTOMERS");
    expect(scopeForEndpointCategory("appointments")).toBe("APPOINTMENTS");
    expect(scopeForEndpointCategory("inventory")).toBe("INVENTORY");
  });

  it("returns null for search and custom, which have no dedicated wizard toggle", () => {
    expect(scopeForEndpointCategory("search")).toBeNull();
    expect(scopeForEndpointCategory("custom")).toBeNull();
  });
});
