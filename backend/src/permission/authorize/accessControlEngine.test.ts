import { describe, it, expect } from "vitest";
import { evaluateAccess, evaluateAccessBatch } from "./accessControlEngine";
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

describe("evaluateAccess", () => {
  it("allows a request matching an active site-level grant", () => {
    const decision = evaluateAccess([grant()], { installationId: "install-1", dataScope: "PRODUCTS", purpose: "ai_training" });
    expect(decision.allowed).toBe(true);
    expect(decision.matchedGrantId).toBe("grant-1");
  });

  it("denies a request with no matching grant", () => {
    const decision = evaluateAccess([], { installationId: "install-1", dataScope: "PRODUCTS", purpose: "ai_training" });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/No active permission grant/);
  });

  it("denies a request when the only matching grant is REVOKED", () => {
    const decision = evaluateAccess([grant({ status: "REVOKED" })], { installationId: "install-1", dataScope: "PRODUCTS", purpose: "ai_training" });
    expect(decision.allowed).toBe(false);
  });

  it("does not let a site-level grant authorize a connector-scoped request", () => {
    const decision = evaluateAccess([grant({ connectorId: null })], { installationId: "install-1", dataScope: "PRODUCTS", connectorId: "conn-1", purpose: "ai_tool_call" });
    expect(decision.allowed).toBe(false);
  });

  it("does not let a connector-scoped grant authorize a site-level request", () => {
    const decision = evaluateAccess([grant({ connectorId: "conn-1" })], { installationId: "install-1", dataScope: "PRODUCTS", purpose: "ai_training" });
    expect(decision.allowed).toBe(false);
  });

  it("matches a connector-scoped grant to the same connector's request", () => {
    const decision = evaluateAccess([grant({ connectorId: "conn-1" })], { installationId: "install-1", dataScope: "PRODUCTS", connectorId: "conn-1", purpose: "ai_tool_call" });
    expect(decision.allowed).toBe(true);
  });

  it("does not cross-authorize a different connector's grant", () => {
    const decision = evaluateAccess([grant({ connectorId: "conn-1" })], { installationId: "install-1", dataScope: "PRODUCTS", connectorId: "conn-2", purpose: "ai_tool_call" });
    expect(decision.allowed).toBe(false);
  });

  it("requires the dataScope to match exactly", () => {
    const decision = evaluateAccess([grant({ dataScope: "SERVICES" })], { installationId: "install-1", dataScope: "PRODUCTS", purpose: "ai_training" });
    expect(decision.allowed).toBe(false);
  });
});

describe("evaluateAccessBatch", () => {
  it("evaluates every query independently", () => {
    const grants = [grant({ dataScope: "PRODUCTS" }), grant({ id: "grant-2", dataScope: "SERVICES" })];
    const decisions = evaluateAccessBatch(grants, "install-1", [{ dataScope: "PRODUCTS" }, { dataScope: "FAQS" }], "ai_training");
    expect(decisions.map((d) => d.allowed)).toEqual([true, false]);
  });
});
