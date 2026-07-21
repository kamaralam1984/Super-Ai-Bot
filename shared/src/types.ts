/**
 * Shared contract between the Installer backend and the Wizard frontend.
 * Both workspaces import from @kvl/shared so the API and UI can never drift apart.
 */

export type CheckStatus = "pass" | "warn" | "fail" | "pending";

export interface RequirementCheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  required: boolean;
}

export interface RequirementCheckResult {
  items: RequirementCheckItem[];
  allRequiredPassed: boolean;
  checkedAt: string;
}

export interface EnvironmentInfo {
  os: string;
  osVersion: string;
  hostname: string;
  timezone: string;
  publicIp: string | null;
  https: { port443Listening: boolean };
  sslCertificate: { found: boolean; source: string | null; issuer: string | null; expiresAt: string | null };
  ports: { port: number; label: string; inUse: boolean }[];
  firewall: { active: boolean | null; tool: string | null; detail: string };
  webServer: { nginx: boolean; apache: boolean };
  docker: { installed: boolean; running: boolean; version: string | null };
  detectedAt: string;
}

export interface WebsiteValidationInput {
  websiteName: string;
  websiteUrl: string;
}

export interface WebsiteValidationResult {
  websiteName: string;
  websiteUrl: string;
  dns: { resolved: boolean; addresses: string[] };
  ssl: { valid: boolean; issuer: string | null; expiresAt: string | null };
  https: { supported: boolean };
  httpRedirectsToHttps: boolean;
  reachable: { ok: boolean; statusCode: number | null; latencyMs: number | null };
  robotsTxt: { found: boolean; url: string };
  sitemapXml: { found: boolean; url: string };
  homepageAvailable: boolean;
  overallValid: boolean;
  errors: string[];
}

export interface GeneratedConfig {
  applicationId: string;
  installationId: string;
  createdAt: string;
  database: { host: string; port: number; name: string; user: string };
  vectorDatabase: { provider: string; host: string; port: number; collection: string };
  redis: { host: string; port: number; db: number };
}

export type InstallStepId =
  | "system_check"
  | "environment_validation"
  | "website_validation"
  | "configuration"
  | "security"
  | "database"
  | "directories"
  | "permissions"
  | "scanning"
  | "training"
  | "finalizing";

export interface InstallProgressEvent {
  stepId: InstallStepId;
  label: string;
  status: "running" | "success" | "error";
  message: string;
  progressPercent: number;
  timestamp: string;
  durationMs?: number;
}

export interface InstallErrorDetail {
  stepId: InstallStepId;
  title: string;
  message: string;
  suggestedFix: string;
  retryable: boolean;
}

export interface InstallLogEntry {
  time: string;
  status: "info" | "success" | "warn" | "error";
  component: string;
  message: string;
  durationMs?: number;
  error?: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  created: boolean;
  mode: string;
}

export interface DirectoryStructureResult {
  entries: DirectoryEntry[];
  allReady: boolean;
}

export interface InstallationRecord {
  installationId: string;
  applicationId: string;
  websiteName: string;
  websiteUrl: string;
  status: "in_progress" | "completed" | "failed" | "rolled_back";
  startedAt: string;
  completedAt: string | null;
}

/**
 * Phase 7 — Enterprise Permission & Connector Access Engine. Shared with
 * the frontend (unlike Phases 2-6's types, which stay backend-local — see
 * backend/src/permission/types.ts's doc comment) because the Permission
 * Wizard is genuinely a UI surface, not an automatic background pipeline.
 */
export type DataScope = "PRODUCTS" | "SERVICES" | "FAQS" | "ORDERS" | "CUSTOMERS" | "INVENTORY" | "APPOINTMENTS" | "CATEGORIES" | "PRICING" | "SHIPPING" | "BLOGS" | "SUPPORT_ARTICLES";

export interface DataScopeDefinition {
  scope: DataScope;
  label: string;
  description: string;
  category: "commerce" | "content" | "customer" | "operations";
  sensitivity: "standard" | "sensitive";
  appliesTo: Array<"site" | "connector">;
}

export interface WizardScopeOption extends DataScopeDefinition {
  granted: boolean;
  grantId?: string;
}

export interface WizardState {
  installationId: string;
  connectorId: string | null;
  options: WizardScopeOption[];
}

export interface WizardSubmissionResult {
  granted: DataScope[];
  revoked: DataScope[];
  unchanged: DataScope[];
  state: WizardState;
}
