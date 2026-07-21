// Error Classification + Recovery Engine — turns an HTTP status code or a
// caught network error into a typed category with a clear, actionable
// recovery suggestion. Pure functions only; the orchestrator/routes decide
// what to actually do (retry, notify, surface to the admin UI) with the
// classification this produces.

import type { ClassifiedError } from "../types";

export function classifyHttpStatus(statusCode: number, context?: string): ClassifiedError {
  const suffix = context ? ` (${context})` : "";
  switch (statusCode) {
    case 401:
      return { category: "auth_expired", httpStatus: 401, message: `Authentication rejected${suffix}.`, recoverySuggestion: "The credential is missing, invalid, or expired — refresh or re-enter it in the connector's authentication settings.", retryable: false };
    case 403:
      return { category: "forbidden", httpStatus: 403, message: `Access forbidden${suffix}.`, recoverySuggestion: "The credential is valid but lacks permission for this resource — verify the API key/token has read scope for this endpoint.", retryable: false };
    case 404:
      return { category: "not_found", httpStatus: 404, message: `Endpoint not found${suffix}.`, recoverySuggestion: "This endpoint may not exist on this platform/version — re-run API discovery, or check the base URL is correct.", retryable: false };
    case 429:
      return { category: "rate_limited", httpStatus: 429, message: `Rate limited by the target system${suffix}.`, recoverySuggestion: "Back off and retry after a delay; consider lowering this connector's configured rate limit to stay under the target's threshold.", retryable: true };
    default:
      if (statusCode >= 500) {
        return { category: "server_error", httpStatus: statusCode, message: `Target system returned a server error (${statusCode})${suffix}.`, recoverySuggestion: "This is likely transient — the engine will retry automatically with backoff; if it persists, the target system may be down.", retryable: true };
      }
      return { category: "unknown", httpStatus: statusCode, message: `Unexpected HTTP status ${statusCode}${suffix}.`, recoverySuggestion: "Review the response body for details; this status isn't one of the classified categories.", retryable: false };
  }
}

export function classifyNetworkError(error: Error, context?: string): ClassifiedError {
  const suffix = context ? ` (${context})` : "";
  const message = error.message.toLowerCase();
  const code = (error as NodeJS.ErrnoException).code;

  if (code === "ETIMEDOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT" || message.includes("timeout")) {
    return { category: "network_timeout", message: `Request timed out${suffix}.`, recoverySuggestion: "The target system is slow or unreachable — verify it's online, or raise this connector's timeout if it's simply a slow API.", retryable: true };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || message.includes("getaddrinfo") || message.includes("dns")) {
    return { category: "dns_error", message: `DNS resolution failed${suffix}.`, recoverySuggestion: "The connector's base URL hostname doesn't resolve — verify it's spelled correctly and the DNS record still exists.", retryable: false };
  }
  if (code?.startsWith("ERR_TLS") || code === "CERT_HAS_EXPIRED" || message.includes("certificate") || message.includes("ssl") || message.includes("tls")) {
    return { category: "ssl_error", message: `TLS/SSL handshake failed${suffix}.`, recoverySuggestion: "The target's certificate is invalid, expired, or self-signed — this must be fixed on the target system; the engine will not bypass certificate validation.", retryable: false };
  }
  if (error.name === "SsrfBlockedError") {
    return { category: "network_timeout", message: `Blocked as an unsafe destination${suffix}: ${error.message}`, recoverySuggestion: "The connector's base URL resolves to a private/internal address — this is intentionally blocked and will not be retried.", retryable: false };
  }
  return { category: "unknown", message: `${error.message}${suffix}`, recoverySuggestion: "No specific recovery path known for this error — check the connector's logs for the full detail.", retryable: false };
}

export function classifyError(input: { statusCode?: number; error?: Error }, context?: string): ClassifiedError {
  if (input.statusCode !== undefined) return classifyHttpStatus(input.statusCode, context);
  if (input.error) return classifyNetworkError(input.error, context);
  return { category: "unknown", message: "No error information provided.", recoverySuggestion: "Nothing to classify.", retryable: false };
}
