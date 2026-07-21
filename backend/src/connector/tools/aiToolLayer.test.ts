import { describe, it, expect, vi, beforeEach } from "vitest";

const restGetMock = vi.hoisted(() => vi.fn());
vi.mock("../client/readOnlyHttpClient", () => ({ restGet: restGetMock }));
vi.mock("../vault/credentialVault", () => ({ openCredential: vi.fn(() => ({ authMethod: "NONE" })) }));

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
  searchProducts,
  searchServices,
  AI_TOOL_NAMES,
} from "./aiToolLayer";
import type { ConnectorRecordService, ConnectorRecord } from "../connectorRecord.service";
import type { EndpointCategory } from "../types";

function fakeRecords(endpointsByCategory: Partial<Record<EndpointCategory, { path: string }>>): ConnectorRecordService {
  return {
    getEndpointForCategory: vi.fn(async (_connectorId: string, category: EndpointCategory) => {
      const endpoint = endpointsByCategory[category];
      return endpoint ? { id: "ep1", category, path: endpoint.path, method: "GET", discoveredVia: "known-pattern", validated: true, responseSample: null, latencyMs: null, errorMessage: null, lastValidatedAt: null } : null;
    }),
    getCredential: vi.fn(async () => null),
    recordEvent: vi.fn(async () => undefined),
  } as unknown as ConnectorRecordService;
}

const connector: ConnectorRecord = {
  id: "conn-1",
  installationId: "install-1",
  crawlJobId: null,
  name: "Test Connector",
  connectorType: "WOOCOMMERCE",
  authMethod: "NONE",
  baseUrl: "https://shop.example.com",
  status: "CONNECTED",
  priority: 0,
  config: { timeoutMs: 5000, maxRedirects: 3, retryPolicy: { maxAttempts: 1, baseDelayMs: 100, maxDelayMs: 100 }, rateLimit: { maxTokens: 100, refillPerSecond: 100 }, circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 1000 } },
  healthScore: null,
  securityScore: null,
  lastHealthCheckAt: null,
  lastErrorMessage: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function okResponse(body: unknown) {
  return { ok: true, statusCode: 200, latencyMs: 5, body: Buffer.from(JSON.stringify(body)), headers: {}, finalUrl: "https://shop.example.com" };
}

beforeEach(() => {
  restGetMock.mockReset();
  restGetMock.mockResolvedValue(okResponse({ ok: true }));
});

describe("AI_TOOL_NAMES", () => {
  it("lists every tool this module actually exports", () => {
    expect(AI_TOOL_NAMES).toEqual([
      "getProducts",
      "searchProducts",
      "getProductDetails",
      "getServices",
      "searchServices",
      "getOrderStatus",
      "getOrders",
      "getCustomer",
      "searchCustomer",
      "getInventory",
      "getAppointments",
      "searchAppointments",
      "searchKnowledge",
    ]);
  });
});

describe("list vs. single-resource tools", () => {
  it("getProducts calls the bare products endpoint", async () => {
    const records = fakeRecords({ products: { path: "/wp-json/wc/v3/products" } });
    await getProducts(records, connector);
    expect(restGetMock.mock.calls[0][0].path).toBe("/wp-json/wc/v3/products");
  });

  it("getProductDetails appends the id as a path segment", async () => {
    const records = fakeRecords({ products: { path: "/wp-json/wc/v3/products" } });
    await getProductDetails(records, connector, "42");
    expect(restGetMock.mock.calls[0][0].path).toBe("/wp-json/wc/v3/products/42");
  });

  it("getOrders (list) and getOrderStatus (single) hit the same category differently", async () => {
    const records = fakeRecords({ orders: { path: "/wp-json/wc/v3/orders" } });
    await getOrders(records, connector);
    expect(restGetMock.mock.calls[0][0].path).toBe("/wp-json/wc/v3/orders");

    await getOrderStatus(records, connector, "999");
    expect(restGetMock.mock.calls[1][0].path).toBe("/wp-json/wc/v3/orders/999");
  });

  it("getOrderStatus with no orderId hits the bare endpoint (no trailing slash)", async () => {
    const records = fakeRecords({ orders: { path: "/wp-json/wc/v3/orders" } });
    await getOrderStatus(records, connector);
    expect(restGetMock.mock.calls[0][0].path).toBe("/wp-json/wc/v3/orders");
  });

  it("getCustomer appends the id as a path segment on the users category", async () => {
    const records = fakeRecords({ users: { path: "/wp-json/wp/v2/users" } });
    await getCustomer(records, connector, "7");
    expect(restGetMock.mock.calls[0][0].path).toBe("/wp-json/wp/v2/users/7");
  });
});

describe("search tools", () => {
  it("searchProducts appends ?search=<query>", async () => {
    const records = fakeRecords({ products: { path: "/wp-json/wc/v3/products" } });
    await searchProducts(records, connector, "widget");
    expect(restGetMock.mock.calls[0][0].path).toBe("/wp-json/wc/v3/products?search=widget");
  });

  it("searchServices appends ?search=<query>", async () => {
    const records = fakeRecords({ services: { path: "/api/services" } });
    await searchServices(records, connector, "consulting");
    expect(restGetMock.mock.calls[0][0].path).toBe("/api/services?search=consulting");
  });

  it("searchCustomer appends ?search=<query> on the users category", async () => {
    const records = fakeRecords({ users: { path: "/wp-json/wp/v2/users" } });
    await searchCustomer(records, connector, "jane");
    expect(restGetMock.mock.calls[0][0].path).toBe("/wp-json/wp/v2/users?search=jane");
  });

  it("searchAppointments appends ?search=<query>", async () => {
    const records = fakeRecords({ appointments: { path: "/api/appointments" } });
    await searchAppointments(records, connector, "monday");
    expect(restGetMock.mock.calls[0][0].path).toBe("/api/appointments?search=monday");
  });

  it("URL-encodes special characters in the search query", async () => {
    const records = fakeRecords({ products: { path: "/products" } });
    await searchProducts(records, connector, "wire & cable");
    expect(restGetMock.mock.calls[0][0].path).toBe("/products?search=wire+%26+cable");
  });

  it("appends the query with & when the endpoint path already has a query string", async () => {
    const records = fakeRecords({ inventory: { path: "/products?stock_status=instock" } });
    await getInventory(records, connector);
    expect(restGetMock.mock.calls[0][0].path).toBe("/products?stock_status=instock");
  });
});

describe("guard rails shared by every tool", () => {
  it("refuses to call when the connector is not CONNECTED/DEGRADED", async () => {
    const records = fakeRecords({ products: { path: "/products" } });
    const disconnected: ConnectorRecord = { ...connector, status: "DISCONNECTED" };
    const result = await getProducts(records, disconnected);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DISCONNECTED/);
    expect(restGetMock).not.toHaveBeenCalled();
  });

  it("returns a clear error when no validated endpoint exists for the category", async () => {
    const records = fakeRecords({});
    const result = await getAppointments(records, connector);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No validated appointments endpoint/);
    expect(restGetMock).not.toHaveBeenCalled();
  });
});
