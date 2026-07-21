import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PermissionOrchestratorService } from "../permissionOrchestrator.service";
import type { ConnectorRecord, ConnectorRecordService } from "../../connector/connectorRecord.service";
import type { DataScope } from "../types";

const innerToolMocks = vi.hoisted(() => ({
  getProducts: vi.fn(),
  searchProducts: vi.fn(),
  getProductDetails: vi.fn(),
  getServices: vi.fn(),
  searchServices: vi.fn(),
  getOrderStatus: vi.fn(),
  getOrders: vi.fn(),
  getCustomer: vi.fn(),
  searchCustomer: vi.fn(),
  getAppointments: vi.fn(),
  searchAppointments: vi.fn(),
  getInventory: vi.fn(),
  searchKnowledge: vi.fn(),
}));

vi.mock("../../connector/tools/aiToolLayer", () => innerToolMocks);

// Imported after the mock is registered so it picks up the mocked module.
import {
  getAppointments,
  getCustomer,
  getInventory,
  getOrders,
  getOrderStatus,
  getProductDetails,
  getProducts,
  getServices,
  searchAppointments,
  searchCustomer,
  searchKnowledge,
  searchProducts,
  searchServices,
} from "./authorizedAiToolLayer";

function fakePermissions(allowedScopes: DataScope[]) {
  const allowed = new Set(allowedScopes);
  return {
    checkAccess: vi.fn(async (req: { dataScope: DataScope }) => ({
      allowed: allowed.has(req.dataScope),
      dataScope: req.dataScope,
      connectorId: null,
      reason: allowed.has(req.dataScope) ? "ok" : "denied",
    })),
  } as unknown as PermissionOrchestratorService;
}

const connector = { id: "conn-1", installationId: "install-1" } as ConnectorRecord;
const records = {} as ConnectorRecordService;

beforeEach(() => {
  Object.values(innerToolMocks).forEach((mock) => mock.mockReset());
});

describe("authorizedAiToolLayer — scope gating", () => {
  it("calls through to the real tool when PRODUCTS is granted", async () => {
    innerToolMocks.getProducts.mockResolvedValue({ ok: true, data: [{ name: "Widget", price: "9.99" }] });
    const permissions = fakePermissions(["PRODUCTS", "PRICING"]);
    const result = await getProducts(permissions, records, connector);
    expect(innerToolMocks.getProducts).toHaveBeenCalledWith(records, connector);
    expect(result).toEqual({ ok: true, data: [{ name: "Widget", price: "9.99" }] });
  });

  it("denies without calling the real tool when PRODUCTS is not granted", async () => {
    const permissions = fakePermissions([]);
    const result = await getProducts(permissions, records, connector);
    expect(innerToolMocks.getProducts).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Permission denied/);
  });

  it.each([
    ["getOrderStatus", getOrderStatus, "ORDERS", innerToolMocks.getOrderStatus],
    ["getOrders", getOrders, "ORDERS", innerToolMocks.getOrders],
    ["getAppointments", getAppointments, "APPOINTMENTS", innerToolMocks.getAppointments],
    ["getInventory", getInventory, "INVENTORY", innerToolMocks.getInventory],
  ] as const)("%s is gated on its own scope", async (_name, fn, scope, mock) => {
    mock.mockResolvedValue({ ok: true, data: [] });
    const denied = await fn(fakePermissions([]), records, connector);
    expect(denied.ok).toBe(false);
    expect(mock).not.toHaveBeenCalled();

    const allowed = await fn(fakePermissions([scope]), records, connector);
    expect(allowed.ok).toBe(true);
  });

  it.each([
    ["searchProducts", () => searchProducts(fakePermissions([]), records, connector, "q"), () => searchProducts(fakePermissions(["PRODUCTS"]), records, connector, "q"), innerToolMocks.searchProducts],
    ["getProductDetails", () => getProductDetails(fakePermissions([]), records, connector, "id"), () => getProductDetails(fakePermissions(["PRODUCTS"]), records, connector, "id"), innerToolMocks.getProductDetails],
    ["searchServices", () => searchServices(fakePermissions([]), records, connector, "q"), () => searchServices(fakePermissions(["SERVICES"]), records, connector, "q"), innerToolMocks.searchServices],
    ["getCustomer", () => getCustomer(fakePermissions([]), records, connector, "id"), () => getCustomer(fakePermissions(["CUSTOMERS"]), records, connector, "id"), innerToolMocks.getCustomer],
    ["searchCustomer", () => searchCustomer(fakePermissions([]), records, connector, "q"), () => searchCustomer(fakePermissions(["CUSTOMERS"]), records, connector, "q"), innerToolMocks.searchCustomer],
    ["searchAppointments", () => searchAppointments(fakePermissions([]), records, connector, "q"), () => searchAppointments(fakePermissions(["APPOINTMENTS"]), records, connector, "q"), innerToolMocks.searchAppointments],
  ] as const)("%s is gated on its own scope", async (_name, callDenied, callAllowed, mock) => {
    mock.mockResolvedValue({ ok: true, data: [] });
    const denied = await callDenied();
    expect(denied.ok).toBe(false);
    expect(mock).not.toHaveBeenCalled();

    const allowed = await callAllowed();
    expect(allowed.ok).toBe(true);
  });
});

describe("authorizedAiToolLayer — pricing redaction", () => {
  it("strips price fields from Products/Services results when PRICING is not granted", async () => {
    innerToolMocks.getProducts.mockResolvedValue({ ok: true, data: [{ name: "Widget", price: "9.99" }] });
    const permissions = fakePermissions(["PRODUCTS"]); // no PRICING
    const result = await getProducts(permissions, records, connector);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([{ name: "Widget" }]);
  });

  it("keeps price fields when PRICING is granted", async () => {
    innerToolMocks.getServices.mockResolvedValue({ ok: true, data: [{ name: "Setup", price: "49.99" }] });
    const permissions = fakePermissions(["SERVICES", "PRICING"]);
    const result = await getServices(permissions, records, connector);
    expect(result.data).toEqual([{ name: "Setup", price: "49.99" }]);
  });

  it("does not redact Orders results (documented v1 limitation)", async () => {
    innerToolMocks.getOrderStatus.mockResolvedValue({ ok: true, data: { total: "19.99" } });
    const permissions = fakePermissions(["ORDERS"]); // no PRICING, shouldn't matter here
    const result = await getOrderStatus(permissions, records, connector, "order-1");
    expect(result.data).toEqual({ total: "19.99" });
  });

  it("also redacts pricing from searchProducts and getProductDetails results", async () => {
    innerToolMocks.searchProducts.mockResolvedValue({ ok: true, data: [{ name: "Widget", price: "9.99" }] });
    innerToolMocks.getProductDetails.mockResolvedValue({ ok: true, data: { name: "Widget", price: "9.99" } });
    const permissions = fakePermissions(["PRODUCTS"]); // no PRICING

    expect((await searchProducts(permissions, records, connector, "widget")).data).toEqual([{ name: "Widget" }]);
    expect((await getProductDetails(permissions, records, connector, "id-1")).data).toEqual({ name: "Widget" });
  });
});

describe("authorizedAiToolLayer — searchKnowledge", () => {
  it("passes through unfiltered searches without any permission check", async () => {
    innerToolMocks.searchKnowledge.mockResolvedValue({ ok: true, data: { results: [] } });
    const permissions = fakePermissions([]);
    const result = await searchKnowledge(permissions, "install-1", "postgres://db", { installationId: "install-1", query: "hello" });
    expect(permissions.checkAccess).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("gates a category-filtered search that maps to a wizard scope", async () => {
    const permissions = fakePermissions([]);
    const result = await searchKnowledge(permissions, "install-1", "postgres://db", { installationId: "install-1", query: "hello", category: "Products" });
    expect(result.ok).toBe(false);
    expect(innerToolMocks.searchKnowledge).not.toHaveBeenCalled();
  });

  it("allows a category-filtered search when its scope is granted", async () => {
    innerToolMocks.searchKnowledge.mockResolvedValue({ ok: true, data: { results: [] } });
    const permissions = fakePermissions(["PRODUCTS"]);
    const result = await searchKnowledge(permissions, "install-1", "postgres://db", { installationId: "install-1", query: "hello", category: "Products" });
    expect(result.ok).toBe(true);
  });

  it("does not gate a category with no dedicated wizard scope (e.g. Company)", async () => {
    innerToolMocks.searchKnowledge.mockResolvedValue({ ok: true, data: { results: [] } });
    const permissions = fakePermissions([]);
    const result = await searchKnowledge(permissions, "install-1", "postgres://db", { installationId: "install-1", query: "hello", category: "Company" });
    expect(permissions.checkAccess).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});
