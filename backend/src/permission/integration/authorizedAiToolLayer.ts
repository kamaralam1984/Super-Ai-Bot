// Authorized AI Tool Layer — wraps connector/tools/aiToolLayer.ts's
// connector-backed tools with a Permission Engine check before any
// outbound call is made, plus best-effort Pricing field redaction. The
// underlying aiToolLayer.ts is untouched and still enforces its own
// connector-status/endpoint-validation gate (see its module doc comment)
// — this is an additional, independent authorization layer in front of
// it, not a replacement. connector.routes.ts (the only caller of the raw
// aiToolLayer today) is updated to call through here instead.

import * as aiToolLayer from "../../connector/tools/aiToolLayer";
import { redactPricingFields } from "../redact/fieldRedaction";
import { scopeForChunkCategory } from "../catalog/dataScopeCatalog";
import type { PermissionOrchestratorService } from "../permissionOrchestrator.service";
import type { ConnectorRecordService, ConnectorRecord } from "../../connector/connectorRecord.service";
import type { ToolResult, SearchKnowledgeParams } from "../../connector/tools/aiToolLayer";
import type { DataScope } from "../types";

export { AI_TOOL_NAMES } from "../../connector/tools/aiToolLayer";
export type { AiToolName, ToolResult } from "../../connector/tools/aiToolLayer";

async function guardedCall(permissions: PermissionOrchestratorService, connector: ConnectorRecord, dataScope: DataScope, run: () => Promise<ToolResult>): Promise<ToolResult> {
  const decision = await permissions.checkAccess({ installationId: connector.installationId, dataScope, connectorId: connector.id, purpose: "ai_tool_call" });
  if (!decision.allowed) {
    return { ok: false, error: `Permission denied: ${decision.reason}`, source: { connectorId: connector.id, endpoint: dataScope } };
  }
  return run();
}

/** Best-effort: if the caller wasn't granted PRICING for this connector, strip price-shaped fields from an otherwise-authorized result rather than deny the whole category. Applied only to Products/Services, where a "browse without prices" use case is real; Orders/Appointments/Inventory are not redacted (a documented v1 limitation — see docs/PERMISSION_ENGINE.md). */
async function withPricingRedaction(permissions: PermissionOrchestratorService, connector: ConnectorRecord, result: ToolResult): Promise<ToolResult> {
  if (!result.ok || result.data === undefined) return result;
  const decision = await permissions.checkAccess({ installationId: connector.installationId, dataScope: "PRICING", connectorId: connector.id, purpose: "field_redaction_check" });
  if (decision.allowed) return result;
  return { ...result, data: redactPricingFields(result.data) };
}

export async function getProducts(permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord): Promise<ToolResult> {
  const result = await guardedCall(permissions, connector, "PRODUCTS", () => aiToolLayer.getProducts(records, connector));
  return withPricingRedaction(permissions, connector, result);
}

export async function searchProducts(permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord, query: string): Promise<ToolResult> {
  const result = await guardedCall(permissions, connector, "PRODUCTS", () => aiToolLayer.searchProducts(records, connector, query));
  return withPricingRedaction(permissions, connector, result);
}

export async function getProductDetails(permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord, productId: string): Promise<ToolResult> {
  const result = await guardedCall(permissions, connector, "PRODUCTS", () => aiToolLayer.getProductDetails(records, connector, productId));
  return withPricingRedaction(permissions, connector, result);
}

export async function getServices(permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord): Promise<ToolResult> {
  const result = await guardedCall(permissions, connector, "SERVICES", () => aiToolLayer.getServices(records, connector));
  return withPricingRedaction(permissions, connector, result);
}

export async function searchServices(permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord, query: string): Promise<ToolResult> {
  const result = await guardedCall(permissions, connector, "SERVICES", () => aiToolLayer.searchServices(records, connector, query));
  return withPricingRedaction(permissions, connector, result);
}

export async function getOrderStatus(permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord, orderId?: string): Promise<ToolResult> {
  return guardedCall(permissions, connector, "ORDERS", () => aiToolLayer.getOrderStatus(records, connector, orderId));
}

export async function getOrders(permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord): Promise<ToolResult> {
  return guardedCall(permissions, connector, "ORDERS", () => aiToolLayer.getOrders(records, connector));
}

export async function getCustomer(permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord, customerId: string): Promise<ToolResult> {
  return guardedCall(permissions, connector, "CUSTOMERS", () => aiToolLayer.getCustomer(records, connector, customerId));
}

export async function searchCustomer(permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord, query: string): Promise<ToolResult> {
  return guardedCall(permissions, connector, "CUSTOMERS", () => aiToolLayer.searchCustomer(records, connector, query));
}

export async function getAppointments(permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord): Promise<ToolResult> {
  return guardedCall(permissions, connector, "APPOINTMENTS", () => aiToolLayer.getAppointments(records, connector));
}

export async function searchAppointments(permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord, query: string): Promise<ToolResult> {
  return guardedCall(permissions, connector, "APPOINTMENTS", () => aiToolLayer.searchAppointments(records, connector, query));
}

export async function getInventory(permissions: PermissionOrchestratorService, records: ConnectorRecordService, connector: ConnectorRecord): Promise<ToolResult> {
  return guardedCall(permissions, connector, "INVENTORY", () => aiToolLayer.getInventory(records, connector));
}

/**
 * searchKnowledge has no single connector or dataScope — it's a free-text
 * query across the installation's whole knowledge base. When the caller
 * filters by `category` and that category maps to a wizard scope (e.g.
 * "Products"), that one scope is checked against the site-level (not
 * connector-scoped) grants. An unfiltered or unmapped-category search
 * stays open, matching Phase 3's existing search UX and its own audit
 * trail (SearchQueryLog) — a documented, deliberate choice, not an
 * oversight; see docs/PERMISSION_ENGINE.md.
 */
export async function searchKnowledge(permissions: PermissionOrchestratorService, installationId: string, databaseUrl: string, params: SearchKnowledgeParams): Promise<ToolResult> {
  if (params.category) {
    const scope = scopeForChunkCategory(params.category);
    if (scope) {
      const decision = await permissions.checkAccess({ installationId, dataScope: scope, purpose: "ai_tool_call" });
      if (!decision.allowed) {
        return { ok: false, error: `Permission denied: ${decision.reason}` };
      }
    }
  }
  return aiToolLayer.searchKnowledge(databaseUrl, params);
}
