// Connection Health Monitoring Engine — runs a single lightweight health
// check against a connector's most representative endpoint and computes a
// rolling health score from recent check history. The orchestrator/routes
// call `performHealthCheck` on a schedule (or on demand); `computeHealthScore`
// and `classifyStatus` are pure functions over whatever history the record
// service hands back, so they're independently unit-testable.

import { restGet } from "../client/readOnlyHttpClient";
import type { ConnectorRuntimeConfig, ConnectorStatus, HealthCheckResult, RawCredentialInput } from "../types";

const LATENCY_CEILING_MS = 5_000; // latency at/above this scores 0 on the latency component

export interface HealthCheckOptions {
  connectorId: string;
  baseUrl: string;
  checkPath: string;
  credential: RawCredentialInput;
  config: ConnectorRuntimeConfig;
}

export async function performHealthCheck(options: HealthCheckOptions): Promise<HealthCheckResult> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await restGet({
      connectorId: options.connectorId,
      baseUrl: options.baseUrl,
      path: options.checkPath,
      method: "HEAD",
      credential: options.credential,
      config: options.config,
    });

    if (response.statusCode === 405) {
      // Some servers reject HEAD outright — fall back to GET for the health probe.
      const getResponse = await restGet({
        connectorId: options.connectorId,
        baseUrl: options.baseUrl,
        path: options.checkPath,
        method: "GET",
        credential: options.credential,
        config: options.config,
      });
      return {
        status: getResponse.ok ? "CONNECTED" : "DEGRADED",
        latencyMs: getResponse.latencyMs,
        availability: getResponse.ok ? 1 : 0,
        errorMessage: getResponse.ok ? undefined : `HTTP ${getResponse.statusCode}`,
        checkedAt,
      };
    }

    return {
      status: response.ok ? "CONNECTED" : "DEGRADED",
      latencyMs: response.latencyMs,
      availability: response.ok ? 1 : 0,
      errorMessage: response.ok ? undefined : `HTTP ${response.statusCode}`,
      checkedAt,
    };
  } catch (err) {
    return {
      status: "DISCONNECTED",
      latencyMs: null,
      availability: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}

/** 0-100 rolling health score: 70% weight on availability, 30% on latency, over the supplied history (most recent first or last — order doesn't matter here). */
export function computeHealthScore(history: HealthCheckResult[]): number {
  if (history.length === 0) return 0;

  const availabilityRatio = history.reduce((sum, h) => sum + h.availability, 0) / history.length;

  const latencySamples = history.filter((h) => h.latencyMs !== null).map((h) => h.latencyMs as number);
  const avgLatency = latencySamples.length > 0 ? latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length : LATENCY_CEILING_MS;
  const latencyScore = Math.max(0, 1 - avgLatency / LATENCY_CEILING_MS);

  return Math.round((0.7 * availabilityRatio + 0.3 * latencyScore) * 100);
}

/** Derives an overall connector status from recent check history — a single flaky check degrades rather than immediately disconnects, so transient blips don't flap the status. */
export function classifyStatus(recentHistory: HealthCheckResult[]): ConnectorStatus {
  if (recentHistory.length === 0) return "PENDING";
  const last = recentHistory[recentHistory.length - 1];
  if (last.status === "CONNECTED") return "CONNECTED";

  const failureStreak = [...recentHistory].reverse().findIndex((h) => h.status === "CONNECTED");
  const consecutiveFailures = failureStreak === -1 ? recentHistory.length : failureStreak;

  if (consecutiveFailures >= 3) return "DISCONNECTED";
  return "DEGRADED";
}
