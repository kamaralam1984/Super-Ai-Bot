// Connector Event Logging — the single place that fans a connector
// lifecycle event out to both destinations every other phase's security
// events go through: the structured file logger (auditLog.ts →
// logs/installer.log, for grep/tail-based operator access) and, via the
// caller, the durable per-connector ConnectorEvent table (for the admin UI
// timeline and health-score computation). Keeping the two logs from
// drifting means routing every connector event through exactly one
// function rather than calling recordAuditEvent ad hoc from six modules.

import { recordAuditEvent } from "../../knowledge/security/auditLog";
import type { ConnectorEventType } from "../types";

const EVENT_TO_AUDIT_TYPE: Record<ConnectorEventType, Parameters<typeof recordAuditEvent>[0]["type"]> = {
  CREATED: "connector_created",
  UPDATED: "connector_updated",
  AUTHENTICATED: "connector_authenticated",
  API_CALL: "connector_api_call",
  ERROR: "connector_error",
  RETRY: "connector_retry",
  HEALTH_CHECK: "connector_health_check",
  DISCONNECTED: "connector_disconnected",
  RECOVERED: "connector_recovered",
};

/** Logs to the structured file audit trail. Callers additionally persist the same event to ConnectorEvent (connectorRecord.service.ts's recordEvent) for durable, queryable per-connector history — this function alone does not touch the database. */
export function logConnectorEvent(connectorId: string, eventType: ConnectorEventType, detail: string, metadata?: Record<string, unknown>): void {
  recordAuditEvent({
    type: EVENT_TO_AUDIT_TYPE[eventType],
    detail: `[connector:${connectorId}] ${detail}`,
    metadata,
    component: "connector-security",
  });
}
