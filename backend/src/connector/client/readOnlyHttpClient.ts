// The Read-Only HTTP Client — the single choke point every connector call
// to a customer's system passes through. It is what turns "read-only" from
// a policy into a guarantee:
//
//   - REST calls are restricted to GET/HEAD. There is no escape hatch.
//   - GraphQL calls are POST (required by the GraphQL-over-HTTP convention)
//     but the query body is parsed and rejected if it contains a
//     `mutation`/`subscription` operation — the actual thing "read-only"
//     needs to mean for GraphQL, since blocking POST outright would also
//     block introspection and read queries.
//
// Built on Phase 2's safeFetch (SSRF-guarded DNS resolution), with its own
// per-connector rate limiting, retry-with-backoff, and circuit breaking.

import { safeFetch } from "../../scanner/http/safeFetch";
import { resolveAuth } from "../auth/authManager";
import { TokenBucketRateLimiter } from "../../knowledge/security/accessControl";
import { CircuitBreaker } from "./circuitBreaker";
import type { ConnectorRuntimeConfig, RawCredentialInput } from "../types";

export class CircuitOpenError extends Error {
  constructor(connectorId: string) {
    super(`Circuit breaker is OPEN for connector ${connectorId} — too many recent failures, refusing to attempt this call`);
    this.name = "CircuitOpenError";
  }
}

export class RateLimitedError extends Error {
  constructor(connectorId: string) {
    super(`Connector ${connectorId} is locally rate-limited — too many requests in this window`);
    this.name = "RateLimitedError";
  }
}

export class MutationRejectedError extends Error {
  constructor() {
    super("Refusing to send a GraphQL operation that contains a mutation/subscription keyword — the Smart Connector Engine only ever issues read queries.");
    this.name = "MutationRejectedError";
  }
}

export interface ReadOnlyResponse {
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
  finalUrl: string;
}

const breakers = new Map<string, CircuitBreaker>();
const limiters = new Map<string, TokenBucketRateLimiter>();

// Each connector configures its own retry/rate-limit/circuit-breaker
// policy (ConnectorRuntimeConfig), so the breaker/limiter instances are
// per-connector too — a single shared instance would silently apply one
// connector's thresholds to every other connector in the process.
function breakerFor(connectorId: string, config: ConnectorRuntimeConfig): CircuitBreaker {
  let breaker = breakers.get(connectorId);
  if (!breaker) {
    breaker = new CircuitBreaker(config.circuitBreaker);
    breakers.set(connectorId, breaker);
  }
  return breaker;
}

function limiterFor(connectorId: string, config: ConnectorRuntimeConfig): TokenBucketRateLimiter {
  let limiter = limiters.get(connectorId);
  if (!limiter) {
    limiter = new TokenBucketRateLimiter(config.rateLimit);
    limiters.set(connectorId, limiter);
  }
  return limiter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, config: ConnectorRuntimeConfig): number {
  const delay = config.retryPolicy.baseDelayMs * 2 ** (attempt - 1);
  return Math.min(delay, config.retryPolicy.maxDelayMs);
}

/** Strips GraphQL `#`-line-comments before keyword-scanning, so a comment merely mentioning "mutation" doesn't trip the guard while an actual `mutation { ... }` operation always does. */
function assertReadOnlyGraphQLQuery(query: string): void {
  const stripped = query.replace(/#.*$/gm, "");
  if (/\bmutation\b/i.test(stripped) || /\bsubscription\b/i.test(stripped)) {
    throw new MutationRejectedError();
  }
}

async function executeWithResilience(
  connectorId: string,
  config: ConnectorRuntimeConfig,
  attempt: () => Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: Buffer; finalUrl: string }>
): Promise<ReadOnlyResponse> {
  const breaker = breakerFor(connectorId, config);
  if (!breaker.canAttempt(connectorId)) {
    throw new CircuitOpenError(connectorId);
  }
  if (!limiterFor(connectorId, config).tryConsume(connectorId)) {
    throw new RateLimitedError(connectorId);
  }

  let lastError: unknown;
  for (let attemptNum = 1; attemptNum <= config.retryPolicy.maxAttempts; attemptNum++) {
    const startedAt = Date.now();
    try {
      const result = await attempt();
      const latencyMs = Date.now() - startedAt;

      if (result.statusCode >= 500 && attemptNum < config.retryPolicy.maxAttempts) {
        await sleep(backoffDelay(attemptNum, config));
        continue;
      }

      if (result.statusCode >= 500) {
        breaker.recordFailure(connectorId);
      } else {
        breaker.recordSuccess(connectorId);
      }

      return {
        ok: result.statusCode >= 200 && result.statusCode < 300,
        statusCode: result.statusCode,
        latencyMs,
        body: result.body,
        headers: result.headers,
        finalUrl: result.finalUrl,
      };
    } catch (err) {
      lastError = err;
      if (attemptNum < config.retryPolicy.maxAttempts) {
        await sleep(backoffDelay(attemptNum, config));
        continue;
      }
    }
  }

  breaker.recordFailure(connectorId);
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface RestGetOptions {
  connectorId: string;
  baseUrl: string;
  path: string;
  method?: "GET" | "HEAD";
  credential: RawCredentialInput;
  config: ConnectorRuntimeConfig;
  extraHeaders?: Record<string, string>;
}

export async function restGet(options: RestGetOptions): Promise<ReadOnlyResponse> {
  const method = options.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    throw new Error(`readOnlyHttpClient.restGet only permits GET/HEAD, got "${method}"`);
  }
  const url = new URL(options.path, options.baseUrl).toString();
  const auth = resolveAuth(options.credential, method, options.path);

  return executeWithResilience(options.connectorId, options.config, async () => {
    const result = await safeFetch(url, {
      method,
      headers: { ...auth.headers, ...options.extraHeaders },
      timeoutMs: options.config.timeoutMs,
      maxRedirects: options.config.maxRedirects,
    });
    return result;
  });
}

export interface GraphqlQueryOptions {
  connectorId: string;
  baseUrl: string;
  path: string;
  query: string;
  variables?: Record<string, unknown>;
  credential: RawCredentialInput;
  config: ConnectorRuntimeConfig;
  extraHeaders?: Record<string, string>;
}

export async function graphqlQuery(options: GraphqlQueryOptions): Promise<ReadOnlyResponse> {
  assertReadOnlyGraphQLQuery(options.query);
  const url = new URL(options.path, options.baseUrl).toString();
  const auth = resolveAuth(options.credential, "POST", options.path);
  const body = JSON.stringify({ query: options.query, variables: options.variables ?? {} });

  return executeWithResilience(options.connectorId, options.config, async () => {
    const result = await safeFetch(url, {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json", ...options.extraHeaders },
      body,
      timeoutMs: options.config.timeoutMs,
      maxRedirects: options.config.maxRedirects,
    });
    return result;
  });
}

export function getCircuitState(connectorId: string) {
  return breakers.get(connectorId)?.getState(connectorId) ?? "CLOSED";
}

export function resetConnectorResilienceState(connectorId: string): void {
  breakers.delete(connectorId);
  limiters.delete(connectorId);
}
