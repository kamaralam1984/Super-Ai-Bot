import { describe, it, expect, vi } from "vitest";
import { AuthorizedTrainingRecordService } from "./authorizedTrainingRecordService";
import type { PermissionOrchestratorService } from "../permissionOrchestrator.service";
import type { TrainingRecordService } from "../../training/trainingRecord.service";
import type { DataScope } from "../types";

/** A fake PermissionOrchestratorService that allows exactly the scopes passed in, and records every check it received — enough to test AuthorizedTrainingRecordService's gating/filtering logic without a real database. */
function fakePermissions(allowedScopes: DataScope[]) {
  const checks: DataScope[] = [];
  const allowed = new Set(allowedScopes);
  return {
    checks,
    service: {
      checkAccess: vi.fn(async (req: { dataScope: DataScope }) => {
        checks.push(req.dataScope);
        return { allowed: allowed.has(req.dataScope), dataScope: req.dataScope, connectorId: null, reason: allowed.has(req.dataScope) ? "ok" : "denied" };
      }),
    } as unknown as PermissionOrchestratorService,
  };
}

function fakeInner(overrides: Partial<TrainingRecordService> = {}) {
  return {
    getProductsForInstallation: vi.fn(async () => [{ id: "p1", pageId: "page1", name: "Widget", category: null, description: null, stockStatus: null }]),
    getServicesForInstallation: vi.fn(async () => [{ id: "s1", pageId: "page1", name: "Setup", description: null, workflow: null, industries: [] }]),
    getFaqsForInstallation: vi.fn(async () => [{ id: "f1", pageId: "page1", question: "Q", answer: "A", source: "heuristic", isDuplicate: false, duplicateOfFaqId: null }]),
    getPoliciesForInstallation: vi.fn(async () => [
      { id: "pol-shipping", pageId: "page1", title: "Shipping Policy", content: "...", policyType: "SHIPPING" },
      { id: "pol-refund", pageId: "page1", title: "Refund Policy", content: "...", policyType: "REFUND" },
    ]),
    getContactsForInstallation: vi.fn(async () => [{ id: "c1", pageId: "page1" }]),
    getChunksByCategory: vi.fn(async (_installationId: string, category: string) => [{ id: `chunk-${category}`, pageId: "page1", title: null, content: "..." }]),
    getAllLiveChunksForQualityCheck: vi.fn(async () => [
      { id: "chunk-products", content: "...", category: "Products", confidenceScore: 1, isDuplicate: false, duplicateOfChunkId: null },
      { id: "chunk-company", content: "...", category: "Company", confidenceScore: 1, isDuplicate: false, duplicateOfChunkId: null },
      { id: "chunk-blogs", content: "...", category: "Blogs", confidenceScore: 1, isDuplicate: false, duplicateOfChunkId: null },
    ]),
    getRelationshipsForInstallation: vi.fn(async () => [
      { id: "r1", sourceType: "Product" as const, sourceId: "p1", targetType: "Category" as const, targetId: "cat1", relationshipType: "PRODUCT_CATEGORY" as const, confidence: 1, evidence: [], createdAt: new Date() },
      { id: "r2", sourceType: "Faq" as const, sourceId: "f1", targetType: "Service" as const, targetId: "s1", relationshipType: "FAQ_SERVICE" as const, confidence: 1, evidence: [], createdAt: new Date() },
    ]),
    close: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as TrainingRecordService;
}

describe("AuthorizedTrainingRecordService — whole-method gates", () => {
  it("returns products when PRODUCTS is granted", async () => {
    const inner = fakeInner();
    const { service } = fakePermissions(["PRODUCTS"]);
    const authorized = new AuthorizedTrainingRecordService(inner, service, "install-1");
    const products = await authorized.getProductsForInstallation("install-1");
    expect(products).toHaveLength(1);
  });

  it("returns an empty array (not a throw) when PRODUCTS is not granted", async () => {
    const inner = fakeInner();
    const { service } = fakePermissions([]);
    const authorized = new AuthorizedTrainingRecordService(inner, service, "install-1");
    const products = await authorized.getProductsForInstallation("install-1");
    expect(products).toEqual([]);
    expect(inner.getProductsForInstallation).not.toHaveBeenCalled();
  });

  it("gates FAQs independently of Products", async () => {
    const inner = fakeInner();
    const { service } = fakePermissions(["PRODUCTS"]);
    const authorized = new AuthorizedTrainingRecordService(inner, service, "install-1");
    expect(await authorized.getFaqsForInstallation("install-1")).toEqual([]);
    expect(await authorized.getProductsForInstallation("install-1")).toHaveLength(1);
  });
});

describe("AuthorizedTrainingRecordService — per-row policy filtering", () => {
  it("returns only Shipping policies when SHIPPING is granted but SUPPORT_ARTICLES isn't", async () => {
    const inner = fakeInner();
    const { service } = fakePermissions(["SHIPPING"]);
    const authorized = new AuthorizedTrainingRecordService(inner, service, "install-1");
    const policies = await authorized.getPoliciesForInstallation("install-1");
    expect(policies.map((p) => p.id)).toEqual(["pol-shipping"]);
  });

  it("returns both when both scopes are granted", async () => {
    const inner = fakeInner();
    const { service } = fakePermissions(["SHIPPING", "SUPPORT_ARTICLES"]);
    const authorized = new AuthorizedTrainingRecordService(inner, service, "install-1");
    const policies = await authorized.getPoliciesForInstallation("install-1");
    expect(policies.map((p) => p.id).sort()).toEqual(["pol-refund", "pol-shipping"]);
  });

  it("returns none when neither scope is granted", async () => {
    const inner = fakeInner();
    const { service } = fakePermissions([]);
    const authorized = new AuthorizedTrainingRecordService(inner, service, "install-1");
    expect(await authorized.getPoliciesForInstallation("install-1")).toEqual([]);
  });
});

describe("AuthorizedTrainingRecordService — chunk category gating", () => {
  it("allows an unmapped category (Company) unconditionally", async () => {
    const inner = fakeInner();
    const { service, checks } = fakePermissions([]);
    const authorized = new AuthorizedTrainingRecordService(inner, service, "install-1");
    const chunks = await authorized.getChunksByCategory("install-1", "Company");
    expect(chunks).toHaveLength(1);
    expect(checks).toEqual([]); // no permission check made at all for an unmapped category
  });

  it("blocks a mapped category (Blogs) when not granted", async () => {
    const inner = fakeInner();
    const { service } = fakePermissions([]);
    const authorized = new AuthorizedTrainingRecordService(inner, service, "install-1");
    expect(await authorized.getChunksByCategory("install-1", "Blogs")).toEqual([]);
  });

  it("allows a mapped category (Blogs) when granted", async () => {
    const inner = fakeInner();
    const { service } = fakePermissions(["BLOGS"]);
    const authorized = new AuthorizedTrainingRecordService(inner, service, "install-1");
    expect(await authorized.getChunksByCategory("install-1", "Blogs")).toHaveLength(1);
  });
});

describe("AuthorizedTrainingRecordService — quality-check chunk filtering", () => {
  it("keeps general-content chunks and only the authorized category chunks", async () => {
    const inner = fakeInner();
    const { service } = fakePermissions(["BLOGS"]);
    const authorized = new AuthorizedTrainingRecordService(inner, service, "install-1");
    const chunks = await authorized.getAllLiveChunksForQualityCheck("install-1");
    expect(chunks.map((c) => c.id).sort()).toEqual(["chunk-blogs", "chunk-company"]); // products chunk dropped, company (unmapped) kept
  });
});

describe("AuthorizedTrainingRecordService — relationship entity-type filtering", () => {
  it("drops an edge whose source/target entity type maps to an ungranted scope", async () => {
    const inner = fakeInner();
    const { service } = fakePermissions(["FAQS", "SERVICES"]);
    const authorized = new AuthorizedTrainingRecordService(inner, service, "install-1");
    const relationships = await authorized.getRelationshipsForInstallation("install-1");
    // r1 (Product→Category) needs PRODUCTS, not granted → dropped.
    // r2 (Faq→Service) needs FAQS+SERVICES, both granted → kept.
    expect(relationships.map((r) => r.id)).toEqual(["r2"]);
  });
});

describe("AuthorizedTrainingRecordService — access summary", () => {
  it("records every check made, allowed and denied", async () => {
    const inner = fakeInner();
    const { service } = fakePermissions(["PRODUCTS"]);
    const authorized = new AuthorizedTrainingRecordService(inner, service, "install-1");
    await authorized.getProductsForInstallation("install-1");
    await authorized.getFaqsForInstallation("install-1");
    const summary = authorized.getAccessSummary();
    expect(summary).toEqual([
      { dataScope: "PRODUCTS", allowed: true, reason: "ok" },
      { dataScope: "FAQS", allowed: false, reason: "denied" },
    ]);
  });
});
