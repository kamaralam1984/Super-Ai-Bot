// Backend-local types for every dashboard-facing domain that isn't
// already in @kvl/shared (scan/knowledge/techdetect/connector/training/
// chat/monitor/deployment never had frontend types before this admin
// dashboard — see docs/DEPLOYMENT.md and each phase's own doc for the
// backend shapes these mirror).

// ── Scan ─────────────────────────────────────────────────────────────────
export interface CrawlReportOutput {
  websiteInfo: { baseUrl: string; robotsTxtFound: boolean };
  totalPages: number;
  scannedPages: number;
  failedPages: number;
  productsFound: number;
  servicesFound: number;
  blogsFound: number;
  documentsFound: number;
  imagesFound: number;
  faqsFound: number;
  formsFound: number;
  languages: Record<string, number>;
  seoSummary: { pagesMissingMetaTitle: number; pagesMissingMetaDescription: number; pagesMissingH1: number; imagesMissingAlt: number };
  performanceSummary: { averageLoadTimeMs: number | null; slowestPages: { url: string; loadTimeMs: number }[] };
  errors: { url: string; error: string }[];
  warnings: string[];
  securityObservations: string[];
}

export interface ProgressEvent {
  step: string;
  message: string;
  percent: number;
}

// ── Training ─────────────────────────────────────────────────────────────
export interface TrainingReportData {
  crawlJobId: string;
  incremental: boolean;
  totalDocuments: number;
  totalPages: number;
  productsLearned: number;
  servicesLearned: number;
  faqsLearned: number;
  policiesLearned: number;
  contactsLearned: number;
  embeddingsGenerated: number;
  relationshipsCreated: number;
  trainingTimeMs: number;
  categoryBreakdown: Record<string, number>;
  overallConfidence: number;
  errors: string[];
  warnings: string[];
}

export interface TrainingResult {
  success: boolean;
  crawlJobId: string;
  report?: TrainingReportData;
  errorMessage?: string;
  chunkStats?: { chunksAdded: number; chunksUpdated: number; chunksRemoved: number; chunksDuplicate: number };
}

// ── Connectors ───────────────────────────────────────────────────────────
export type ConnectorType =
  | "WORDPRESS" | "WOOCOMMERCE" | "SHOPIFY" | "MAGENTO" | "OPENCART" | "PRESTASHOP"
  | "LARAVEL" | "GENERIC_REST" | "GENERIC_GRAPHQL" | "UNIVERSAL_REST" | "WEBHOOK" | "SOAP_API" | "GRPC_API";

export type ConnectorStatus = "PENDING" | "CONNECTED" | "DISCONNECTED" | "ERROR" | "DEGRADED";

export interface ConnectorRecord {
  id: string;
  installationId: string;
  crawlJobId: string | null;
  name: string;
  connectorType: ConnectorType;
  authMethod: string;
  baseUrl: string;
  status: ConnectorStatus;
  priority: number;
  healthScore: number | null;
  securityScore: number | null;
  lastHealthCheckAt: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Chat admin ───────────────────────────────────────────────────────────
export type ConversationStatus = "ACTIVE" | "IDLE" | "ESCALATED" | "CLOSED";
export type EscalationStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "CANCELLED";

export interface ConversationRecord {
  id: string;
  installationId: string;
  visitorId: string;
  status: ConversationStatus;
  language: string | null;
  topicSummary: string | null;
  startedAt: string;
  lastMessageAt: string;
  closedAt: string | null;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  intent: string | null;
  language: string | null;
  confidence: number | null;
  createdAt: string;
}

export interface EscalationTicketRecord {
  id: string;
  conversationId: string;
  installationId: string;
  reason: string;
  channel: string;
  status: EscalationStatus;
  triggeredBy: string;
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ConversationAnalyticsReport {
  totalConversations: number;
  averageResponseTimeMs: number | null;
  averageConversationLengthMessages: number;
  resolvedConversations: number;
  escalatedConversations: number;
  userSatisfaction: { likes: number; dislikes: number; ratio: number | null };
  topQuestions: { question: string; count: number }[];
  failedQuestions: { question: string; count: number }[];
  knowledgeCoverage: number | null;
}

// ── Monitor (Phase 10) ───────────────────────────────────────────────────
export interface ComparisonReportSummary {
  crawlJobId: string;
  previousCrawlJobId: string | null;
  generatedAt: string;
}

export interface EntityChangeSummary {
  category: string;
  added: number;
  removed: number;
  updated: number;
}

export interface KnowledgeComparisonReportData {
  crawlJobId: string;
  previousCrawlJobId: string | null;
  pagesAdded: number;
  pagesRemoved: number;
  pagesUpdated: number;
  pagesUnchanged: number;
  chunksAdded: number;
  chunksRemoved: number;
  chunksUpdated: number;
  chunksDuplicate: number;
  entityChanges: EntityChangeSummary[];
  metadataChanges: { sitemapChanged: boolean; robotsTxtChanged: boolean; technologyChanged: boolean; addedTechnologies: string[]; removedTechnologies: string[] };
  categoryBreakdown: Record<string, { added: number; removed: number; updated: number }>;
  generatedAt: string;
}

export interface NotificationRecord {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "ERROR" | "SUCCESS";
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationSettingsInput {
  emailEnabled: boolean;
  emailAddress: string | null;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  enabledEmailTypes: string[];
  enabledWebhookTypes: string[];
}

export interface BackgroundJobRecord {
  id: string;
  type: string;
  status: string;
  lastError: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ScanScheduleRecord {
  id: string;
  crawlJobId: string;
  cronExpression: string;
  label: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

// ── Deployment (Phase 11) ────────────────────────────────────────────────
export interface HealthCheckItem {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  durationMs: number;
}
export interface HealthReport {
  status: "pass" | "warn" | "fail";
  checkedAt: string;
  items: HealthCheckItem[];
}
export interface VersionInfo {
  version: string;
  nodeVersion: string;
  nodeEnv: string;
  startedAt: string;
}
export interface BackupRecordRow {
  id: string;
  label: string | null;
  type: "MANUAL" | "SCHEDULED" | "PRE_UPDATE";
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  filePath: string;
  sizeBytes: string | null;
  checksumSha256: string | null;
  includes: string[];
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface PluginRow {
  id: string;
  name: string;
  version: string;
  entryPoint: string;
  permissions: string[];
  status: "ENABLED" | "DISABLED" | "ERROR";
  errorMessage: string | null;
  installedAt: string;
  updatedAt: string;
}
export interface LicenseRow {
  id: string;
  licenseKey: string;
  tier: "STANDARD" | "ENTERPRISE" | "AGENCY";
  machineFingerprint: string;
  status: "ACTIVE" | "EXPIRED" | "INVALID" | "REVOKED";
  issuedAt: string;
  expiresAt: string | null;
  activatedAt: string;
  lastValidatedAt: string;
}
