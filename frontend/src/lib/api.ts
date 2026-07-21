import type {
  RequirementCheckResult,
  EnvironmentInfo,
  WebsiteValidationInput,
  WebsiteValidationResult,
  InstallLogEntry,
  DataScope,
  DataScopeDefinition,
  WizardState,
  WizardSubmissionResult,
} from "@kvl/shared";
import type {
  CrawlReportOutput,
  TrainingReportData,
  TrainingResult,
  ConnectorRecord,
  ConversationRecord,
  ConversationStatus,
  MessageRecord,
  EscalationTicketRecord,
  EscalationStatus,
  ConversationAnalyticsReport,
  ComparisonReportSummary,
  KnowledgeComparisonReportData,
  NotificationRecord,
  NotificationSettingsInput,
  BackgroundJobRecord,
  ScanScheduleRecord,
  HealthReport,
  VersionInfo,
  BackupRecordRow,
  PluginRow,
  LicenseRow,
} from "./dashboardTypes";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { title: string; message: string; suggestedFix: string | null; retryable: boolean };
}

class ApiError extends Error {
  constructor(message: string, public readonly suggestedFix: string | null, public readonly retryable: boolean) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    // Required for the admin dashboard's session cookie (Set by
    // POST /api/admin/login) to actually be sent back on every
    // subsequent request — without this, `fetch` silently omits cookies
    // on requests to a different origin (the dev server's :3041 talking
    // to the backend's :4500; same-origin in production, harmless there
    // either way).
    credentials: "include",
    ...init,
  });
  const json = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || !json.success || !json.data) {
    throw new ApiError(json.error?.message ?? `Request to ${path} failed`, json.error?.suggestedFix ?? null, json.error?.retryable ?? true);
  }
  return json.data;
}

export const api = {
  systemCheck: () => request<RequirementCheckResult>("/system-check"),
  environment: () => request<EnvironmentInfo>("/environment"),
  validateWebsite: (input: WebsiteValidationInput) =>
    request<WebsiteValidationResult>("/website-validation", { method: "POST", body: JSON.stringify(input) }),
  startInstall: (input: WebsiteValidationInput & { socketId: string; grantedScopes: DataScope[] }) =>
    request<{ started: boolean }>("/install/start", { method: "POST", body: JSON.stringify(input) }),
  getLogs: (limit = 100) => request<{ entries: InstallLogEntry[] }>(`/logs?limit=${limit}`),

  // Phase 7 — Enterprise Permission & Connector Access Engine. Most of
  // these require an `x-api-key: <API_SECRET>` header — fine from the
  // authenticated admin dashboard (its backend-for-frontend injects the
  // key server-side from the session cookie), not something this public
  // installer wizard ever attaches directly. `getScopes` is the one
  // exception: the static 12-category catalog, deliberately left public
  // (permission.routes.ts) so the pre-install consent screen
  // (pages/steps/PermissionConsentStep.tsx) can render it before an
  // installation — and therefore an API key — exists. See
  // pages/PermissionWizard.tsx's doc comment and docs/PERMISSION_ENGINE.md.
  permission: {
    getScopes: () => request<DataScopeDefinition[]>("/permission/scopes"),
    getWizardState: (installationId: string, connectorId?: string | null) =>
      request<WizardState>(`/permission/wizard?installationId=${encodeURIComponent(installationId)}${connectorId ? `&connectorId=${encodeURIComponent(connectorId)}` : ""}`),
    submitWizard: (input: { installationId: string; connectorId?: string | null; grantedScopes: DataScope[]; actor: string; notes?: string }) =>
      request<WizardSubmissionResult>("/permission/wizard", { method: "POST", body: JSON.stringify(input) }),
  },

  // Admin dashboard — the authenticated surface every Phase 2-11 admin
  // API above was always meant to be called from (see permission's own
  // comment). Login exchanges API_SECRET for an HttpOnly session cookie;
  // every other admin.* call and every other namespace above it can now
  // reach through the same session (backend/src/middleware/adminSession.ts
  // injects `x-api-key` server-side once a valid cookie is present).
  admin: {
    login: (apiSecret: string) => request<{ authenticated: boolean }>("/admin/login", { method: "POST", body: JSON.stringify({ apiSecret }) }),
    logout: () => request<{ authenticated: boolean }>("/admin/logout", { method: "POST" }),
    session: () => request<{ authenticated: boolean }>("/admin/session"),
    installation: () => request<AdminInstallation>("/admin/installation"),
  },

  // Phase 2 — Website Auto Scanner.
  scan: {
    start: (input: { websiteUrl: string; socketId: string; maxDepth?: number; maxPages?: number; concurrency?: number }) =>
      request<{ started: boolean }>("/scan/start", { method: "POST", body: JSON.stringify(input) }),
  },

  // Phase 6 — Enterprise AI Training Engine.
  training: {
    start: (input: { crawlJobId: string; socketId: string }) => request<{ started: boolean }>("/training/start", { method: "POST", body: JSON.stringify(input) }),
    retrain: (input: { crawlJobId: string; socketId: string }) => request<{ started: boolean }>("/training/retrain", { method: "POST", body: JSON.stringify(input) }),
    getReport: (crawlJobId: string) => request<TrainingReportData>(`/training/report/${encodeURIComponent(crawlJobId)}`),
    listReports: (installationId: string) => request<TrainingReportData[]>(`/training/reports?installationId=${encodeURIComponent(installationId)}`),
  },

  // Phase 5/9 — Smart Connector Engine + extensions.
  connector: {
    list: (installationId: string) => request<ConnectorRecord[]>(`/connector?installationId=${encodeURIComponent(installationId)}`),
    start: (input: { installationId: string; crawlJobId?: string; manualConnectorType?: string; manualBaseUrl?: string; socketId: string }) =>
      request<{ started: boolean }>("/connector/start", { method: "POST", body: JSON.stringify(input) }),
    healthCheck: (id: string) => request<{ status: string }>(`/connector/${encodeURIComponent(id)}/health-check`, { method: "POST" }),
    setPriority: (id: string, priority: number) => request<{ updated: boolean; priority: number }>(`/connector/${encodeURIComponent(id)}/priority`, { method: "PATCH", body: JSON.stringify({ priority }) }),
  },

  // Phase 8 — Enterprise AI Live Chat Engine (admin tier).
  chatAdmin: {
    listConversations: (installationId: string, status?: ConversationStatus) =>
      request<ConversationRecord[]>(`/chat/admin/conversations?installationId=${encodeURIComponent(installationId)}${status ? `&status=${status}` : ""}`),
    getMessages: (conversationId: string) => request<MessageRecord[]>(`/chat/admin/conversations/${encodeURIComponent(conversationId)}/messages`),
    listEscalations: (installationId: string, status?: EscalationStatus) =>
      request<EscalationTicketRecord[]>(`/chat/admin/escalations?installationId=${encodeURIComponent(installationId)}${status ? `&status=${status}` : ""}`),
    updateEscalation: (ticketId: string, status: EscalationStatus) =>
      request<{ updated: boolean }>(`/chat/admin/escalations/${encodeURIComponent(ticketId)}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    analytics: (installationId: string, sinceDays?: number) =>
      request<ConversationAnalyticsReport>(`/chat/admin/analytics?installationId=${encodeURIComponent(installationId)}${sinceDays ? `&sinceDays=${sinceDays}` : ""}`),
  },

  // Phase 10 — Automatic Website Update Engine.
  monitor: {
    listReports: (installationId?: string) => request<ComparisonReportSummary[]>(`/monitor/reports${installationId ? `?installationId=${encodeURIComponent(installationId)}` : ""}`),
    getReport: (crawlJobId: string) => request<KnowledgeComparisonReportData>(`/monitor/reports/${encodeURIComponent(crawlJobId)}`),
    listNotifications: (installationId?: string) => request<NotificationRecord[]>(`/monitor/notifications${installationId ? `?installationId=${encodeURIComponent(installationId)}` : ""}`),
    markNotificationRead: (id: string) => request<{ id: string }>(`/monitor/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
    getNotificationSettings: (installationId?: string) =>
      request<NotificationSettingsInput | null>(`/monitor/notification-settings${installationId ? `?installationId=${encodeURIComponent(installationId)}` : ""}`),
    putNotificationSettings: (input: { installationId: string } & Partial<NotificationSettingsInput>) =>
      request<{ installationId: string }>("/monitor/notification-settings", { method: "PUT", body: JSON.stringify(input) }),
    listJobs: (installationId?: string) => request<BackgroundJobRecord[]>(`/monitor/jobs${installationId ? `?installationId=${encodeURIComponent(installationId)}` : ""}`),
    listSchedules: (installationId?: string) => request<ScanScheduleRecord[]>(`/monitor/schedules${installationId ? `?installationId=${encodeURIComponent(installationId)}` : ""}`),
    createSchedule: (input: { installationId: string; crawlJobId: string; label?: string } & ({ preset: "hourly" | "daily" | "weekly" | "monthly" } | { cronExpression: string })) =>
      request<{ scheduleId: string; cronExpression: string }>("/monitor/schedules", { method: "POST", body: JSON.stringify(input) }),
    setScheduleEnabled: (id: string, enabled: boolean) => request<{ id: string; enabled: boolean }>(`/monitor/schedules/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    deleteSchedule: (id: string) => request<{ deleted: boolean }>(`/monitor/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },

  // Phase 11 — Enterprise Production Deployment System.
  deployment: {
    health: () => request<HealthReport>("/deployment/health"),
    version: () => request<VersionInfo>("/deployment/version"),
    listBackups: () => request<BackupRecordRow[]>("/deployment/backups"),
    createBackup: (label?: string) => request<BackupRecordRow>("/deployment/backups", { method: "POST", body: JSON.stringify({ label }) }),
    pruneBackups: () => request<{ pruned: number }>("/deployment/backups/prune", { method: "POST" }),
    restoreAvailable: () => request<{ id: string; filePath: string; createdAt: string; includes: string[] }[]>("/deployment/restore/available"),
    listPlugins: () => request<PluginRow[]>("/deployment/plugins"),
    discoverPlugins: () => request<string[]>("/deployment/plugins/discover"),
    installPlugin: (pluginDirName: string) => request<PluginRow>("/deployment/plugins/install", { method: "POST", body: JSON.stringify({ pluginDirName }) }),
    enablePlugin: (id: string) => request<{ id: string; status: string }>(`/deployment/plugins/${encodeURIComponent(id)}/enable`, { method: "POST" }),
    disablePlugin: (id: string) => request<{ id: string; status: string }>(`/deployment/plugins/${encodeURIComponent(id)}/disable`, { method: "POST" }),
    pluginHealth: (id: string) => request<PluginRow>(`/deployment/plugins/${encodeURIComponent(id)}/health`),
    removePlugin: (id: string) => request<{ removed: boolean }>(`/deployment/plugins/${encodeURIComponent(id)}`, { method: "DELETE" }),
    getLicense: () => request<LicenseRow | null>("/deployment/license"),
    activateLicense: (licenseFileContent: string) => request<LicenseRow>("/deployment/license/activate", { method: "POST", body: JSON.stringify({ licenseFileContent }) }),
    validateLicense: () => request<{ verdict: { ok: boolean; reason: string; detail: string }; license: LicenseRow | null }>("/deployment/license/validate", { method: "POST" }),
  },
};

export type { CrawlReportOutput, TrainingResult };

export interface AdminInstallation {
  id: string;
  installationId: string;
  websiteName: string;
  websiteUrl: string;
  completedAt: string | null;
}

export { ApiError };
