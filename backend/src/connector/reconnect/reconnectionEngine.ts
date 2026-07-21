// Auto-Reconnection Engine — when a connector's health check fails, this
// tries (in order): refresh an expired OAuth2 token, then retry the health
// check with backoff a bounded number of times. It never blocks or
// interrupts the AI service — every call here is bounded by `maxAttempts`
// and returns a result rather than throwing, so a caller can always fall
// back to "connector unavailable, degrade gracefully" instead of hanging.

import { acquireOAuth2Token, isOAuth2TokenExpired, refreshOAuth2Token } from "../auth/authManager";
import { classifyStatus, performHealthCheck } from "../health/healthMonitor";
import type { ConnectorRuntimeConfig, ConnectorStatus, HealthCheckResult, RawCredentialInput } from "../types";

export interface ReconnectionResult {
  recovered: boolean;
  attempts: number;
  finalStatus: ConnectorStatus;
  history: HealthCheckResult[];
  tokenRefreshed: boolean;
  refreshedCredential?: RawCredentialInput;
  notifyAdministrator: boolean;
  message: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ReconnectionOptions {
  connectorId: string;
  baseUrl: string;
  checkPath: string;
  credential: RawCredentialInput;
  config: ConnectorRuntimeConfig;
  maxAttempts?: number;
}

export async function attemptReconnection(options: ReconnectionOptions): Promise<ReconnectionResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  let credential = options.credential;
  let tokenRefreshed = false;

  if (credential.authMethod === "OAUTH2" && credential.oauth2 && isOAuth2TokenExpired(credential)) {
    try {
      const refreshed = credential.oauth2.refreshToken
        ? await refreshOAuth2Token(credential.oauth2)
        : credential.oauth2.clientId && credential.oauth2.clientSecret && credential.oauth2.tokenUrl
          ? await acquireOAuth2Token(credential.oauth2)
          : null;
      if (refreshed) {
        credential = { ...credential, oauth2: { ...credential.oauth2, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken ?? credential.oauth2.refreshToken, expiresAt: refreshed.expiresAt } };
        tokenRefreshed = true;
      }
    } catch {
      // Refresh failed — fall through to plain health-check retries, which will surface the auth failure clearly.
    }
  }

  const history: HealthCheckResult[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await performHealthCheck({
      connectorId: options.connectorId,
      baseUrl: options.baseUrl,
      checkPath: options.checkPath,
      credential,
      config: options.config,
    });
    history.push(result);

    if (result.status === "CONNECTED") {
      return {
        recovered: true,
        attempts: attempt,
        finalStatus: "CONNECTED",
        history,
        tokenRefreshed,
        refreshedCredential: tokenRefreshed ? credential : undefined,
        notifyAdministrator: false,
        message: `Reconnected successfully after ${attempt} attempt(s).`,
      };
    }

    if (attempt < maxAttempts) {
      await sleep(Math.min(options.config.retryPolicy.baseDelayMs * 2 ** (attempt - 1), options.config.retryPolicy.maxDelayMs));
    }
  }

  const finalStatus = classifyStatus(history);
  return {
    recovered: false,
    attempts: maxAttempts,
    finalStatus,
    history,
    tokenRefreshed,
    refreshedCredential: tokenRefreshed ? credential : undefined,
    notifyAdministrator: true,
    message: `Failed to reconnect after ${maxAttempts} attempts — administrator notification required.`,
  };
}
