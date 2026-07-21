import { TechDetectRecordService } from "../techdetect/techDetectRecord.service";
import { recommendConnector } from "./recommend/recommendationEngine";
import { getConnectorDefinition } from "./registry/connectorRegistry";
import { sealCredential } from "./vault/credentialVault";
import { validateCredentialShape } from "./auth/authManager";
import { discoverEndpoints } from "./discovery/apiDiscoveryEngine";
import { validateEndpoints } from "./validation/apiValidationEngine";
import { validateSslCertificate } from "./validation/sslValidator";
import { performHealthCheck, classifyStatus } from "./health/healthMonitor";
import { generateConnectorReport } from "./report/connectorReportGenerator";
import { logConnectorEvent } from "./events/connectorEvents";
import { ConnectorRecordService } from "./connectorRecord.service";
import { formatError } from "../utils/formatError";
import { DEFAULT_CONNECTOR_CONFIG } from "./types";
import type { ConnectorReport, ConnectorRuntimeConfig, ConnectorType, RawCredentialInput } from "./types";

export interface ConnectorProgressEvent {
  step: string;
  message: string;
  percent: number;
}

export interface ConnectorSetupParams {
  installationId: string;
  crawlJobId?: string;
  /** Overrides the recommendation engine's pick — for an administrator who knows better than the auto-detection. */
  manualConnectorType?: ConnectorType;
  manualBaseUrl?: string;
  credential?: RawCredentialInput;
  config?: Partial<ConnectorRuntimeConfig>;
}

export interface ConnectorSetupResult {
  success: boolean;
  connectorId?: string;
  report?: ConnectorReport;
  errorMessage?: string;
}

/**
 * Top-level Phase 5 pipeline: recommend (or accept a manual override for)
 * a connector, seal+store its credential, discover its API surface,
 * validate every discovered endpoint, run an initial health check, and
 * persist a full ConnectorReport — mirroring Phase 4's
 * runTechDetection() shape (records service constructed once, onProgress
 * callback, try/finally close()).
 */
export async function runConnectorSetup(databaseUrl: string, params: ConnectorSetupParams, onProgress: (event: ConnectorProgressEvent) => void): Promise<ConnectorSetupResult> {
  const records = new ConnectorRecordService(databaseUrl);
  const techRecords = new TechDetectRecordService(databaseUrl);
  let connectorId: string | undefined;

  try {
    onProgress({ step: "recommend", message: "Determining the best-fit connector", percent: 5 });

    const report = params.crawlJobId ? await techRecords.getReport(params.crawlJobId) : null;
    const recommendation = report
      ? recommendConnector(report)
      : {
          connectorType: params.manualConnectorType ?? "UNIVERSAL_REST",
          suggestedName: "Manually Configured Connector",
          baseUrl: params.manualBaseUrl ?? "",
          authMethod: getConnectorDefinition(params.manualConnectorType ?? "UNIVERSAL_REST").defaultAuthMethod,
          confidence: 0,
          reasons: ["No Phase 4 technology report was supplied — configured manually."],
        };

    if (params.manualConnectorType) recommendation.connectorType = params.manualConnectorType;
    if (params.manualBaseUrl) recommendation.baseUrl = params.manualBaseUrl;
    if (!recommendation.baseUrl) {
      throw new Error("No base URL available — supply crawlJobId (with a Phase 4 report) or manualBaseUrl.");
    }

    const config: ConnectorRuntimeConfig = { ...DEFAULT_CONNECTOR_CONFIG, ...params.config };

    onProgress({ step: "create", message: `Creating connector: ${recommendation.suggestedName}`, percent: 15 });
    const connector = await records.createConnector({
      installationId: params.installationId,
      crawlJobId: params.crawlJobId ?? null,
      recommendation,
      config,
    });
    connectorId = connector.id;
    logConnectorEvent(connector.id, "CREATED", `${recommendation.suggestedName} (${recommendation.connectorType}) for ${recommendation.baseUrl}`);

    let credential: RawCredentialInput = params.credential ?? { authMethod: "NONE" };
    if (params.credential) {
      onProgress({ step: "authenticate", message: "Validating and sealing credential", percent: 25 });
      const validation = validateCredentialShape(params.credential);
      if (!validation.valid) {
        throw new Error(`Invalid credential for ${params.credential.authMethod}: ${validation.errors.join("; ")}`);
      }
      const vaulted = sealCredential(params.credential);
      await records.storeCredential(connector.id, vaulted);
      credential = params.credential;
    }

    // Discovery + validation fire a one-time burst of probe requests (known
    // patterns + OpenAPI/GraphQL probing, then one validation call per
    // discovered endpoint — easily 10-20+ calls). The connector's
    // configured rateLimit is sized for steady-state AI-tool traffic, not
    // this burst, and reusing connector.id as the rate-limiter key would
    // silently self-throttle mid-scan — a real endpoint could then vanish
    // from the report with no indication it was ever probed. Setup scanning
    // therefore gets its own generous bucket under a distinct key, isolated
    // from the connector's real runtime rate limit.
    const setupConnectorId = `${connector.id}:setup`;
    const setupConfig: ConnectorRuntimeConfig = { ...config, rateLimit: { maxTokens: 50, refillPerSecond: 10 } };

    onProgress({ step: "discover", message: "Discovering available APIs", percent: 40 });
    const discovery = await discoverEndpoints({
      connectorId: setupConnectorId,
      connectorType: recommendation.connectorType,
      baseUrl: recommendation.baseUrl,
      credential,
      config: setupConfig,
    });

    onProgress({ step: "validate", message: `Validating ${discovery.discovered.length} discovered endpoint(s)`, percent: 60 });
    const validated = await validateEndpoints(discovery.discovered, {
      connectorId: setupConnectorId,
      baseUrl: recommendation.baseUrl,
      credential,
      config: setupConfig,
    });
    await records.saveEndpoints(connector.id, validated);

    onProgress({ step: "health", message: "Running initial health check and validating SSL certificate", percent: 80 });
    const firstValidated = validated.find((e) => e.validated);
    // Independent checks (a health probe against one endpoint, a TLS
    // handshake against the base URL) — run concurrently rather than
    // serially, same reasoning as every other independent Promise.all in
    // this codebase's orchestrators.
    const [healthResult, sslCertificate] = await Promise.all([
      performHealthCheck({ connectorId: connector.id, baseUrl: recommendation.baseUrl, checkPath: firstValidated?.path ?? "/", credential, config }),
      validateSslCertificate(recommendation.baseUrl),
    ]);
    await records.recordHealthCheck(connector.id, healthResult);

    const recentHistory = await records.getRecentHealthChecks(connector.id);
    const status = classifyStatus(recentHistory);
    const endpoints = await records.getEndpoints(connector.id);
    const detectedPlatformName = report ? (report.cms[0]?.name ?? report.backendFrameworks[0]?.name ?? "Unknown platform") : "Manually configured";

    const connectorReport = generateConnectorReport({
      connector: { ...connector, status },
      endpoints,
      recentHealthChecks: recentHistory,
      detectedPlatformName,
      sslCertificate,
    });

    await records.updateConnectorStatus(connector.id, status, {
      healthScore: connectorReport.healthScore,
      securityScore: connectorReport.securityScore,
      lastErrorMessage: healthResult.errorMessage ?? null,
      lastHealthCheckAt: new Date(healthResult.checkedAt),
    });

    if (status === "CONNECTED") {
      logConnectorEvent(connector.id, "AUTHENTICATED", `Connector is CONNECTED — ${endpoints.filter((e) => e.validated).length}/${endpoints.length} endpoints validated.`);
    } else {
      logConnectorEvent(connector.id, "DISCONNECTED", `Connector setup finished in status ${status}.`);
    }

    onProgress({ step: "done", message: "Connector setup complete", percent: 100 });
    return { success: true, connectorId: connector.id, report: connectorReport };
  } catch (err) {
    const message = formatError(err);
    if (connectorId) {
      await records.updateConnectorStatus(connectorId, "ERROR", { lastErrorMessage: message }).catch(() => undefined);
      logConnectorEvent(connectorId, "ERROR", message);
    }
    onProgress({ step: "error", message, percent: 100 });
    return { success: false, connectorId, errorMessage: message };
  } finally {
    await records.close();
    await techRecords.close();
  }
}
