import { logEvent } from "../../utils/logger";

export type AuditEventType =
  | "search_performed"
  | "access_denied"
  | "rate_limited"
  | "encryption_failure"
  | "decryption_failure"
  | "chunk_removed"
  | "rollback_performed"
  | "connector_created"
  | "connector_updated"
  | "connector_authenticated"
  | "connector_api_call"
  | "connector_error"
  | "connector_retry"
  | "connector_health_check"
  | "connector_disconnected"
  | "connector_recovered"
  | "training_retrain_requested"
  | "training_schedule_created"
  | "training_schedule_cancelled"
  | "permission_granted"
  | "permission_revoked"
  | "permission_wizard_completed"
  | "permission_access_checked"
  | "permission_access_denied"
  | "chat_conversation_started"
  | "chat_message_processed"
  | "chat_prompt_injection_detected"
  | "chat_escalation_triggered"
  | "chat_grounding_refused"
  | "chat_response_possibly_ungrounded"
  | "chat_feedback_recorded"
  | "deployment_backup_created"
  | "deployment_backup_failed"
  | "deployment_restore_performed"
  | "deployment_plugin_installed"
  | "deployment_plugin_enabled"
  | "deployment_plugin_disabled"
  | "deployment_plugin_removed"
  | "deployment_license_activated"
  | "deployment_license_activation_rejected"
  | "deployment_license_validation_failed";

const WARN_EVENT_TYPES = new Set<AuditEventType>([
  "access_denied",
  "rate_limited",
  "encryption_failure",
  "decryption_failure",
  "connector_error",
  "connector_disconnected",
  "permission_access_denied",
  "chat_prompt_injection_detected",
  "chat_escalation_triggered",
  "chat_response_possibly_ungrounded",
  "deployment_backup_failed",
  "deployment_license_activation_rejected",
  "deployment_license_validation_failed",
]);

export interface AuditEvent {
  type: AuditEventType;
  detail: string;
  metadata?: Record<string, unknown>;
  component?: string;
}

/**
 * Records a security-relevant event through the same structured logger
 * every other phase's events go through (utils/logger.ts's `logEvent`,
 * writing to both console and logs/installer.log as JSON lines) — a
 * dedicated audit trail without a second, parallel logging mechanism to
 * keep in sync. `SearchQueryLog` in the database covers query-level audit
 * detail; this covers everything else worth an operator being able to
 * grep for later (denied access, rate limiting, crypto failures, data
 * removal, rollbacks).
 */
export function recordAuditEvent(event: AuditEvent): void {
  logEvent({
    component: event.component ?? "knowledge-security",
    message: `[${event.type}] ${event.detail}`,
    status: WARN_EVENT_TYPES.has(event.type) ? "warn" : "info",
    error: event.metadata ? JSON.stringify(event.metadata) : undefined,
  });
}
