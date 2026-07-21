// Connector Report Generator — assembles the final, human-facing
// ConnectorReport from a connector's persisted state. Pure function: every
// input is already-fetched data, no Prisma, no network calls, so it's
// trivially unit-testable with synthetic connector/endpoint/health data.

import { computeHealthScore } from "../health/healthMonitor";
import { isCertificateExpiringSoon } from "../validation/sslValidator";
import type { ConnectorEndpointRecord, ConnectorRecord } from "../connectorRecord.service";
import type { ConnectorReport, HealthCheckResult, SslCertificateInfo } from "../types";

export interface ReportInputs {
  connector: ConnectorRecord;
  endpoints: ConnectorEndpointRecord[];
  recentHealthChecks: HealthCheckResult[];
  detectedPlatformName: string;
  /** `null`/absent for a plain-HTTP connector (nothing to check) or when the caller didn't run the check — see validation/sslValidator.ts. */
  sslCertificate?: SslCertificateInfo | null;
}

function computeSecurityScore(inputs: ReportInputs): number {
  let score = 0;
  if (inputs.connector.baseUrl.startsWith("https://")) score += 40;
  if (inputs.connector.authMethod !== "NONE") score += 20;
  if (inputs.endpoints.some((e) => e.validated)) score += 15;
  if (inputs.connector.status === "CONNECTED") score += 15;
  // A connector that's HTTPS with a genuinely valid, non-expiring-soon
  // certificate earns the last 10 points; HTTPS with an untrusted/expiring
  // certificate earns none of them — "https://" alone was never a strong
  // enough signal on its own (a self-signed or expired cert still starts
  // with "https://").
  if (inputs.sslCertificate?.valid && !isCertificateExpiringSoon(inputs.sslCertificate)) score += 10;
  return Math.min(100, score);
}

function buildRecommendations(inputs: ReportInputs, healthScore: number, securityScore: number): string[] {
  const recommendations: string[] = [];

  if (!inputs.connector.baseUrl.startsWith("https://")) {
    recommendations.push("This connector's base URL uses plain HTTP — credentials and data in transit are not encrypted. Switch to HTTPS if the target system supports it.");
  }
  if (inputs.connector.authMethod === "NONE" && inputs.endpoints.length > 0) {
    recommendations.push("No authentication is configured. This is fine for genuinely public read-only endpoints, but confirm none of the discovered endpoints expose non-public data.");
  }
  const validatedCount = inputs.endpoints.filter((e) => e.validated).length;
  if (inputs.endpoints.length === 0) {
    recommendations.push("No API endpoints were discovered for this connector — verify the base URL and platform detection, or supply endpoint hints manually.");
  } else if (validatedCount === 0) {
    recommendations.push("Endpoints were discovered but none validated successfully — check the credential's scope and the base URL.");
  } else if (validatedCount < inputs.endpoints.length) {
    recommendations.push(`${inputs.endpoints.length - validatedCount} of ${inputs.endpoints.length} discovered endpoints failed validation — see each endpoint's errorMessage for detail.`);
  }
  if (healthScore < 50 && inputs.recentHealthChecks.length > 0) {
    recommendations.push("Recent health checks show degraded availability or high latency — the AI tool layer may return stale or failed results until this recovers.");
  }
  if (inputs.sslCertificate) {
    if (!inputs.sslCertificate.valid) {
      recommendations.push(`This connector's SSL certificate is not trusted (${inputs.sslCertificate.errorMessage ?? "unknown reason"}) — the AI tool layer cannot rely on it; fix the certificate on the target system.`);
    } else if (isCertificateExpiringSoon(inputs.sslCertificate)) {
      recommendations.push(`This connector's SSL certificate expires in ${inputs.sslCertificate.daysUntilExpiry} day(s) — renew it before it lapses and disconnects this connector.`);
    }
  }
  if (securityScore < 70) {
    recommendations.push("Security score is below 70 — review the notes above before relying on this connector in production.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Connector is healthy, secure, and fully validated — no action needed.");
  }
  return recommendations;
}

export function generateConnectorReport(inputs: ReportInputs): ConnectorReport {
  const healthScore = inputs.recentHealthChecks.length > 0 ? computeHealthScore(inputs.recentHealthChecks) : (inputs.connector.healthScore ?? 0);
  const securityScore = computeSecurityScore(inputs);
  const validatedCount = inputs.endpoints.filter((e) => e.validated).length;

  const compatibilityStatus: ConnectorReport["compatibilityStatus"] = validatedCount === 0 ? "incompatible" : validatedCount < inputs.endpoints.length || healthScore < 70 ? "partial" : "compatible";

  const lastCheck = inputs.recentHealthChecks[inputs.recentHealthChecks.length - 1];

  return {
    connectorId: inputs.connector.id,
    detectedPlatform: inputs.detectedPlatformName,
    connectorType: inputs.connector.connectorType,
    authMethod: inputs.connector.authMethod,
    baseUrl: inputs.connector.baseUrl,
    status: inputs.connector.status,
    availableApis: inputs.endpoints.map((e) => ({ category: e.category, path: e.path, validated: e.validated })),
    healthScore,
    securityScore,
    latencyMs: lastCheck?.latencyMs ?? null,
    recommendations: buildRecommendations(inputs, healthScore, securityScore),
    compatibilityStatus,
    generatedAt: new Date().toISOString(),
    sslCertificate: inputs.sslCertificate ?? null,
  };
}
