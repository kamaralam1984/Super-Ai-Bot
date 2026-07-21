// Notification Engine — pure channel-selection decision logic. Dashboard
// and Log always receive every notification (they're free, local, and
// the audit trail shouldn't have gaps); Email and Webhook are opt-in per
// installation and can additionally be scoped to a subset of
// notification types (schema.prisma's `NotificationSettings.
// enabledEmailTypes`/`enabledWebhookTypes` — empty array means "all
// types"). Actual delivery (email/webhook I/O) lives in
// emailChannel.ts/webhookChannel.ts; persistence lives in
// monitorRecord.service.ts. This module decides *where*, never *how* or
// *whether it succeeded*.

export type NotificationChannelName = "DASHBOARD" | "EMAIL" | "WEBHOOK" | "LOG";

// Mirrors schema.prisma's NotificationType enum values exactly (Prisma
// string enums serialize to these same literals) without importing
// @prisma/client here — this module stays engine-pure like every other
// monitor/* detector, matching NotificationChannelName's own precedent of
// a hand-declared union instead of a Prisma import.
export type MonitorNotificationType =
  | "WEBSITE_UPDATED"
  | "TRAINING_COMPLETED"
  | "KNOWLEDGE_UPDATED"
  | "ERROR_OCCURRED"
  | "CONNECTION_FAILED"
  | "NEW_PRODUCTS_FOUND"
  | "NEW_SERVICES_FOUND"
  | "API_CHANGED"
  | "TECHNOLOGY_CHANGED"
  | "JOB_FAILED"
  | "ROLLBACK_PERFORMED";

export type MonitorNotificationSeverity = "INFO" | "WARNING" | "ERROR" | "SUCCESS";

export interface DerivedNotification {
  type: MonitorNotificationType;
  severity: MonitorNotificationSeverity;
  title: string;
  message: string;
}

export interface NotificationSettingsInput {
  emailEnabled: boolean;
  emailAddress: string | null;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  enabledEmailTypes: string[];
  enabledWebhookTypes: string[];
}

function typeEnabled(type: string, enabledTypes: string[]): boolean {
  return enabledTypes.length === 0 || enabledTypes.includes(type);
}

/** `settings` is `null` for an installation that has never configured notification preferences — still gets Dashboard/Log, matching every other feature's "read-only by default, opt in to anything more" posture. */
export function determineChannels(type: string, settings: NotificationSettingsInput | null): NotificationChannelName[] {
  const channels: NotificationChannelName[] = ["DASHBOARD", "LOG"];

  if (settings?.emailEnabled && settings.emailAddress && typeEnabled(type, settings.enabledEmailTypes)) {
    channels.push("EMAIL");
  }
  if (settings?.webhookEnabled && settings.webhookUrl && typeEnabled(type, settings.enabledWebhookTypes)) {
    channels.push("WEBHOOK");
  }

  return channels;
}

// Minimal structural subset of compare/comparisonReportBuilder.ts's
// KnowledgeComparisonReportData/ComparisonHighlight — declared locally
// (not imported) so this module never has to know that file's full shape,
// only the handful of fields a notification decision actually needs.
export interface TrainingNotificationInput {
  pagesAdded: number;
  pagesRemoved: number;
  pagesUpdated: number;
  entityChanges: { category: string; added: number; removed: number; updated: number }[];
  metadataChanges: { technologyChanged: boolean; addedTechnologies: string[]; removedTechnologies: string[] };
}

export interface HighlightInput {
  message: string;
  severity: "info" | "warning";
}

/**
 * Turns one training run's comparison report into the concrete set of
 * notification events worth raising — always exactly one TRAINING_COMPLETED
 * (a run finishing is itself always worth a record, even a no-op one),
 * plus zero or more of the spec's more specific event types when the
 * report shows the change that type exists for. Kept as data in, data
 * out (no Prisma, no delivery) — monitorOrchestrator.service.ts persists
 * and delivers whatever this returns.
 */
export function deriveTrainingNotifications(report: TrainingNotificationInput, highlights: HighlightInput[]): DerivedNotification[] {
  const events: DerivedNotification[] = [];
  const highlightText = highlights.map((h) => h.message).join(" ") || "Training completed with no notable changes.";

  events.push({ type: "TRAINING_COMPLETED", severity: "SUCCESS", title: "AI training completed", message: highlightText });

  const totalPageChurn = report.pagesAdded + report.pagesRemoved + report.pagesUpdated;
  const totalEntityChurn = report.entityChanges.reduce((sum, c) => sum + c.added + c.removed + c.updated, 0);
  if (totalPageChurn > 0 || totalEntityChurn > 0) {
    events.push({ type: "WEBSITE_UPDATED", severity: "INFO", title: "Website changes detected", message: highlightText });
    events.push({ type: "KNOWLEDGE_UPDATED", severity: "INFO", title: "Knowledge base updated", message: highlightText });
  }

  const productChanges = report.entityChanges.find((c) => c.category === "products");
  if (productChanges && productChanges.added > 0) {
    events.push({ type: "NEW_PRODUCTS_FOUND", severity: "INFO", title: `${productChanges.added} new product(s) found`, message: highlightText });
  }
  const serviceChanges = report.entityChanges.find((c) => c.category === "services");
  if (serviceChanges && serviceChanges.added > 0) {
    events.push({ type: "NEW_SERVICES_FOUND", severity: "INFO", title: `${serviceChanges.added} new service(s) found`, message: highlightText });
  }

  if (report.metadataChanges.technologyChanged) {
    const added = report.metadataChanges.addedTechnologies.join(", ") || "none";
    const removed = report.metadataChanges.removedTechnologies.join(", ") || "none";
    events.push({ type: "TECHNOLOGY_CHANGED", severity: "WARNING", title: "Website technology stack changed", message: `Added: ${added}. Removed: ${removed}.` });
  }

  return events;
}
