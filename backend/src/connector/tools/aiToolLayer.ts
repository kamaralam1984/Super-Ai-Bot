// AI Tool Integration Layer — the only interface the chatbot's tool-calling
// layer ever touches. Every function here enforces permission *before*
// execution (the connector must be CONNECTED/DEGRADED, and the category
// must have a validated endpoint) and calls out only through the read-only
// HTTP client, so a tool call can never become a write. `searchKnowledge`
// is the one tool that doesn't touch an external connector at all — it's
// wired directly to Phase 3's real semantic search over the installation's
// own knowledge base.

import { openCredential } from "../vault/credentialVault";
import { restGet } from "../client/readOnlyHttpClient";
import { logConnectorEvent } from "../events/connectorEvents";
import { classifyHttpStatus } from "../errors/errorClassifier";
import { performKnowledgeSearch } from "../../knowledge/knowledgeSearch.service";
import type { ConnectorRecordService, ConnectorRecord } from "../connectorRecord.service";
import type { EndpointCategory } from "../types";

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  source?: { connectorId: string; endpoint: string };
}

const CALLABLE_STATUSES = new Set(["CONNECTED", "DEGRADED"]);

export interface CategoryCallOptions {
  /** Appends `/{idSuffix}` to fetch a single resource by id (e.g. getOrderStatus, getCustomer, getProductDetails). */
  idSuffix?: string;
  /**
   * Appends a query string for a search-style call (e.g. searchProducts,
   * searchCustomer). Uses `search` as the parameter name — the convention
   * both WooCommerce's and WordPress's REST APIs already use, and the most
   * broadly recognized default for a generic REST search. Some platforms
   * use a different parameter name (Shopify's Admin API, for one); this is
   * a documented v1 limitation (see docs/CONNECTOR_EXTENSIONS.md), not a
   * universal guarantee — a per-connector override is a reasonable future
   * enhancement, not something every self-hosted install needs on day one.
   */
  query?: string;
}

async function callCategoryEndpoint(records: ConnectorRecordService, connector: ConnectorRecord, category: EndpointCategory, options?: CategoryCallOptions): Promise<ToolResult> {
  if (!CALLABLE_STATUSES.has(connector.status)) {
    return { ok: false, error: `Connector "${connector.name}" is ${connector.status} — refusing to call ${category} until it reconnects.` };
  }

  const endpoint = await records.getEndpointForCategory(connector.id, category);
  if (!endpoint) {
    return { ok: false, error: `No validated ${category} endpoint is available for connector "${connector.name}". Run API discovery/validation first.` };
  }

  const vaultedCredential = await records.getCredential(connector.id);
  const credential = vaultedCredential ? openCredential(vaultedCredential) : { authMethod: "NONE" as const };
  let path = options?.idSuffix ? `${endpoint.path.replace(/\/$/, "")}/${encodeURIComponent(options.idSuffix)}` : endpoint.path;
  if (options?.query) {
    const separator = path.includes("?") ? "&" : "?";
    path = `${path}${separator}${new URLSearchParams({ search: options.query }).toString()}`;
  }

  try {
    const response = await restGet({ connectorId: connector.id, baseUrl: connector.baseUrl, path, credential, config: connector.config });
    await records.recordEvent(connector.id, "API_CALL", `AI tool call: ${category} → ${path} → HTTP ${response.statusCode}`);
    logConnectorEvent(connector.id, "API_CALL", `${category} → ${path} → HTTP ${response.statusCode}`);

    if (!response.ok) {
      const classified = classifyHttpStatus(response.statusCode, category);
      return { ok: false, error: classified.message, source: { connectorId: connector.id, endpoint: path } };
    }

    return { ok: true, data: JSON.parse(response.body.toString("utf-8")), source: { connectorId: connector.id, endpoint: path } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await records.recordEvent(connector.id, "ERROR", `AI tool call failed: ${category} → ${path}: ${message}`);
    logConnectorEvent(connector.id, "ERROR", `${category} → ${path}: ${message}`);
    return { ok: false, error: message, source: { connectorId: connector.id, endpoint: path } };
  }
}

export async function getProducts(records: ConnectorRecordService, connector: ConnectorRecord): Promise<ToolResult> {
  return callCategoryEndpoint(records, connector, "products");
}

/** Product search — appends `?search=<query>` to the products endpoint (see CategoryCallOptions.query's doc comment for the parameter-name caveat). */
export async function searchProducts(records: ConnectorRecordService, connector: ConnectorRecord, query: string): Promise<ToolResult> {
  return callCategoryEndpoint(records, connector, "products", { query });
}

/** Fetches one product by id — `getProducts` returns a list; this is the single-resource read. */
export async function getProductDetails(records: ConnectorRecordService, connector: ConnectorRecord, productId: string): Promise<ToolResult> {
  return callCategoryEndpoint(records, connector, "products", { idSuffix: productId });
}

export async function getServices(records: ConnectorRecordService, connector: ConnectorRecord): Promise<ToolResult> {
  return callCategoryEndpoint(records, connector, "services");
}

export async function searchServices(records: ConnectorRecordService, connector: ConnectorRecord, query: string): Promise<ToolResult> {
  return callCategoryEndpoint(records, connector, "services", { query });
}

export async function getOrderStatus(records: ConnectorRecordService, connector: ConnectorRecord, orderId?: string): Promise<ToolResult> {
  return callCategoryEndpoint(records, connector, "orders", orderId ? { idSuffix: orderId } : undefined);
}

/** The order list — distinct from `getOrderStatus`, which fetches a single order by id. */
export async function getOrders(records: ConnectorRecordService, connector: ConnectorRecord): Promise<ToolResult> {
  return callCategoryEndpoint(records, connector, "orders");
}

/** "users" doubles as the customer category — see types.ts's EndpointCategory doc comment. */
export async function getCustomer(records: ConnectorRecordService, connector: ConnectorRecord, customerId: string): Promise<ToolResult> {
  return callCategoryEndpoint(records, connector, "users", { idSuffix: customerId });
}

export async function searchCustomer(records: ConnectorRecordService, connector: ConnectorRecord, query: string): Promise<ToolResult> {
  return callCategoryEndpoint(records, connector, "users", { query });
}

export async function getAppointments(records: ConnectorRecordService, connector: ConnectorRecord): Promise<ToolResult> {
  return callCategoryEndpoint(records, connector, "appointments");
}

export async function searchAppointments(records: ConnectorRecordService, connector: ConnectorRecord, query: string): Promise<ToolResult> {
  return callCategoryEndpoint(records, connector, "appointments", { query });
}

export async function getInventory(records: ConnectorRecordService, connector: ConnectorRecord): Promise<ToolResult> {
  return callCategoryEndpoint(records, connector, "inventory");
}

export interface SearchKnowledgeParams {
  installationId: string;
  query: string;
  category?: string;
  language?: string;
  k?: number;
}

/** Wired directly to Phase 3's real semantic search — the one AI tool that isn't a connector call at all. */
export async function searchKnowledge(databaseUrl: string, params: SearchKnowledgeParams): Promise<ToolResult> {
  try {
    const result = await performKnowledgeSearch(databaseUrl, {
      installationId: params.installationId,
      query: params.query,
      category: params.category,
      language: params.language,
      k: params.k,
    });
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const AI_TOOL_NAMES = [
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
] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];
