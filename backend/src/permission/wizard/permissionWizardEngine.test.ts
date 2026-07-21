import { describe, it, expect } from "vitest";
import { buildWizardState, diffWizardSubmission } from "./permissionWizardEngine";
import type { PermissionGrantRecord } from "../types";

function grant(overrides: Partial<PermissionGrantRecord> = {}): PermissionGrantRecord {
  return {
    id: "grant-1",
    installationId: "install-1",
    connectorId: null,
    dataScope: "PRODUCTS",
    accessLevel: "READ_ONLY",
    status: "ACTIVE",
    grantedAt: new Date("2026-01-01T00:00:00Z"),
    grantedBy: "admin@example.com",
    revokedAt: null,
    revokedBy: null,
    notes: null,
    ...overrides,
  };
}

describe("buildWizardState", () => {
  it("shows only site-applicable scopes for the site (connectorId null) wizard", () => {
    const state = buildWizardState("install-1", null, []);
    const scopes = state.options.map((o) => o.scope);
    expect(scopes).toContain("PRODUCTS");
    expect(scopes).not.toContain("ORDERS"); // ORDERS is connector-only
  });

  it("shows connector-applicable scopes for a connector wizard", () => {
    const state = buildWizardState("install-1", "conn-1", []);
    const scopes = state.options.map((o) => o.scope);
    expect(scopes).toContain("ORDERS");
    expect(scopes).toContain("PRODUCTS");
  });

  it("marks an option granted only when an ACTIVE grant matches scope + connectorId", () => {
    const state = buildWizardState("install-1", null, [grant({ dataScope: "PRODUCTS", connectorId: null })]);
    const products = state.options.find((o) => o.scope === "PRODUCTS");
    const services = state.options.find((o) => o.scope === "SERVICES");
    expect(products?.granted).toBe(true);
    expect(products?.grantId).toBe("grant-1");
    expect(services?.granted).toBe(false);
  });

  it("does not treat a connector grant as granted in the site wizard", () => {
    const state = buildWizardState("install-1", null, [grant({ connectorId: "conn-1" })]);
    expect(state.options.find((o) => o.scope === "PRODUCTS")?.granted).toBe(false);
  });

  it("does not treat a REVOKED grant as granted", () => {
    const state = buildWizardState("install-1", null, [grant({ status: "REVOKED" })]);
    expect(state.options.find((o) => o.scope === "PRODUCTS")?.granted).toBe(false);
  });
});

describe("diffWizardSubmission", () => {
  it("computes toGrant for newly submitted scopes", () => {
    const diff = diffWizardSubmission([], ["PRODUCTS", "FAQS"]);
    expect(diff.toGrant.sort()).toEqual(["FAQS", "PRODUCTS"]);
    expect(diff.toRevoke).toEqual([]);
  });

  it("computes toRevoke for scopes dropped from the submission", () => {
    const diff = diffWizardSubmission(["PRODUCTS", "FAQS"], ["PRODUCTS"]);
    expect(diff.toRevoke).toEqual(["FAQS"]);
    expect(diff.toGrant).toEqual([]);
  });

  it("leaves unchanged scopes alone", () => {
    const diff = diffWizardSubmission(["PRODUCTS"], ["PRODUCTS"]);
    expect(diff.unchanged).toEqual(["PRODUCTS"]);
    expect(diff.toGrant).toEqual([]);
    expect(diff.toRevoke).toEqual([]);
  });

  it("handles a full swap in one submission", () => {
    const diff = diffWizardSubmission(["PRODUCTS"], ["SERVICES"]);
    expect(diff.toGrant).toEqual(["SERVICES"]);
    expect(diff.toRevoke).toEqual(["PRODUCTS"]);
  });
});
