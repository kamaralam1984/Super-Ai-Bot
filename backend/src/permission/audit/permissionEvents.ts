// Permission Event Logging — the single place that fans a permission
// lifecycle event out to both destinations every other phase's security
// events go through: the structured file logger (auditLog.ts →
// logs/installer.log, for grep/tail-based operator access) and, via the
// caller, the durable PermissionEvent table (for the admin UI timeline).
// Mirrors connector/events/connectorEvents.ts's exact pattern so the two
// audit surfaces don't drift apart.

import { recordAuditEvent } from "../../knowledge/security/auditLog";
import type { PermissionEventType } from "../types";

const EVENT_TO_AUDIT_TYPE: Record<PermissionEventType, Parameters<typeof recordAuditEvent>[0]["type"]> = {
  GRANTED: "permission_granted",
  REVOKED: "permission_revoked",
  WIZARD_COMPLETED: "permission_wizard_completed",
  ACCESS_CHECKED: "permission_access_checked",
  ACCESS_DENIED: "permission_access_denied",
};

/** Logs to the structured file audit trail. Callers additionally persist the same event to PermissionEvent (permissionRecord.service.ts's recordEvent) for durable, queryable per-installation history — this function alone does not touch the database. */
export function logPermissionEvent(installationId: string, eventType: PermissionEventType, detail: string, metadata?: Record<string, unknown>): void {
  recordAuditEvent({
    type: EVENT_TO_AUDIT_TYPE[eventType],
    detail: `[installation:${installationId}] ${detail}`,
    metadata,
    component: "permission-security",
  });
}
