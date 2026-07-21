import { describe, it, expect, vi, beforeEach } from "vitest";

const performKnowledgeSearchMock = vi.hoisted(() => vi.fn());
vi.mock("../../knowledge/knowledgeSearch.service", () => ({ performKnowledgeSearch: performKnowledgeSearchMock }));

const toolMocks = vi.hoisted(() => ({
  getOrderStatus: vi.fn(),
  getAppointments: vi.fn(),
  getInventory: vi.fn(),
  getProducts: vi.fn(),
  getServices: vi.fn(),
}));
vi.mock("../../permission/integration/authorizedAiToolLayer", () => toolMocks);

import { retrieveFromConnector, retrieveKnowledge } from "./ragRetriever";
import type { PermissionOrchestratorService } from "../../permission/permissionOrchestrator.service";
import type { ConnectorRecordService, ConnectorRecord } from "../../connector/connectorRecord.service";

beforeEach(() => {
  performKnowledgeSearchMock.mockReset();
  Object.values(toolMocks).forEach((m) => m.mockReset());
});

describe("retrieveKnowledge", () => {
  it("maps a grounded search result into a RetrievalResult", async () => {
    performKnowledgeSearchMock.mockResolvedValue({
      answered: true,
      sources: [{ chunkId: "c1", sourceUrl: "https://x/products/a", title: "Widget A", category: "Products", excerpt: "Widget A costs $10.", confidenceScore: 0.9, relevanceScore: 0.8 }],
      overallConfidence: 0.72,
      tookMs: 5,
      cached: false,
    });

    const result = await retrieveKnowledge("postgres://db", { installationId: "install-1", query: "how much is widget a", intent: "pricing_inquiry" });
    expect(result.answered).toBe(true);
    expect(result.evidenceTexts).toEqual(["Widget A costs $10."]);
    expect(result.sources).toHaveLength(1);
    expect(result.overallConfidence).toBe(0.72);
  });

  it("passes the intent-mapped category through to performKnowledgeSearch", async () => {
    performKnowledgeSearchMock.mockResolvedValue({ answered: false, reason: "empty", tookMs: 1, cached: false });
    await retrieveKnowledge("postgres://db", { installationId: "install-1", query: "what's your refund policy", intent: "policy_inquiry" });
    expect(performKnowledgeSearchMock).toHaveBeenCalledWith("postgres://db", expect.objectContaining({ category: "Policies" }));
  });

  it("passes no category for an intent with no dedicated mapping", async () => {
    performKnowledgeSearchMock.mockResolvedValue({ answered: false, reason: "empty", tookMs: 1, cached: false });
    await retrieveKnowledge("postgres://db", { installationId: "install-1", query: "how are you", intent: "small_talk" });
    expect(performKnowledgeSearchMock).toHaveBeenCalledWith("postgres://db", expect.objectContaining({ category: undefined }));
  });

  it("maps a refused search result to answered:false with the refusal reason", async () => {
    performKnowledgeSearchMock.mockResolvedValue({ answered: false, reason: "No matching content was found.", tookMs: 2, cached: false });
    const result = await retrieveKnowledge("postgres://db", { installationId: "install-1", query: "xyz", intent: "unknown" });
    expect(result.answered).toBe(false);
    expect(result.refusalReason).toBe("No matching content was found.");
    expect(result.evidenceTexts).toEqual([]);
  });
});

describe("retrieveFromConnector", () => {
  const permissions = {} as PermissionOrchestratorService;
  const records = {} as ConnectorRecordService;
  const connector = { id: "conn-1", installationId: "install-1", name: "Store Connector", baseUrl: "https://store.example.com" } as ConnectorRecord;

  it("returns answered:false for an intent with no mapped tool", async () => {
    const result = await retrieveFromConnector(permissions, records, connector, { intent: "faq" });
    expect(result.answered).toBe(false);
    expect(result.refusalReason).toMatch(/No connector tool is mapped/);
    expect(toolMocks.getProducts).not.toHaveBeenCalled();
  });

  it("calls getOrderStatus with the orderId for an order_status intent", async () => {
    toolMocks.getOrderStatus.mockResolvedValue({ ok: true, data: { status: "shipped" }, source: { connectorId: "conn-1", endpoint: "/orders/123" } });
    const result = await retrieveFromConnector(permissions, records, connector, { intent: "order_status", orderId: "123" });
    expect(toolMocks.getOrderStatus).toHaveBeenCalledWith(permissions, records, connector, "123");
    expect(result.answered).toBe(true);
    expect(result.evidenceTexts[0]).toContain("shipped");
  });

  it("calls getInventory for an inventory_inquiry intent", async () => {
    toolMocks.getInventory.mockResolvedValue({ ok: true, data: [{ sku: "A1", stock: 5 }] });
    const result = await retrieveFromConnector(permissions, records, connector, { intent: "inventory_inquiry" });
    expect(toolMocks.getInventory).toHaveBeenCalledWith(permissions, records, connector);
    expect(result.answered).toBe(true);
  });

  it("returns answered:false with the tool's error when the call fails (e.g. permission denied)", async () => {
    toolMocks.getProducts.mockResolvedValue({ ok: false, error: "Permission denied: no active grant for PRODUCTS." });
    const result = await retrieveFromConnector(permissions, records, connector, { intent: "product_inquiry" });
    expect(result.answered).toBe(false);
    expect(result.refusalReason).toBe("Permission denied: no active grant for PRODUCTS.");
  });

  it("treats a successful connector call as fully confident (no relevance ranking against a live system)", async () => {
    toolMocks.getAppointments.mockResolvedValue({ ok: true, data: [] });
    const result = await retrieveFromConnector(permissions, records, connector, { intent: "appointment_inquiry" });
    expect(result.overallConfidence).toBe(1);
  });
});
