// API Validation Engine — actually calls each endpoint discovery found and
// verifies it's genuinely usable: authenticates cleanly, responds with a
// healthy HTTP status, replies in reasonable time, and returns parseable,
// structurally sane JSON. Discovery only proves an endpoint *exists*;
// validation proves the AI tool layer can actually depend on it.

import { restGet, graphqlQuery } from "../client/readOnlyHttpClient";
import type { ConnectorRuntimeConfig, DiscoveredEndpoint, RawCredentialInput, ValidatedEndpoint } from "../types";

// Re-exported so "API Validation Engine" (this module, per the spec's own
// naming) is the discoverable home for SSL certificate validation, even
// though the real TLS-handshake implementation lives in sslValidator.ts
// (a per-connector, once-not-per-endpoint check, unlike everything else in
// this file) to keep that mechanism independently testable and reusable.
export { validateSslCertificate, isCertificateExpiringSoon } from "./sslValidator";

const SLOW_LATENCY_MS = 3_000;
const SAMPLE_MAX_CHARS = 2_000;

function isJsonContentType(headers: Record<string, string | string[] | undefined>): boolean {
  const raw = headers["content-type"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.toLowerCase().includes("json");
}

/** A minimal "is this a sane API response shape" check — an object, or an array of objects/primitives — rather than e.g. an HTML error page that happened to return 200. */
function hasSaneJsonShape(parsed: unknown): boolean {
  if (Array.isArray(parsed)) return true;
  if (parsed !== null && typeof parsed === "object") return true;
  return false;
}

function truncatedSample(body: Buffer): unknown {
  const text = body.toString("utf-8");
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch {
    return text.slice(0, SAMPLE_MAX_CHARS);
  }
}

export interface ValidationOptions {
  connectorId: string;
  baseUrl: string;
  credential: RawCredentialInput;
  config: ConnectorRuntimeConfig;
}

export async function validateEndpoint(endpoint: DiscoveredEndpoint, options: ValidationOptions): Promise<ValidatedEndpoint> {
  try {
    const response =
      endpoint.method === "POST" && endpoint.graphqlQuery
        ? await graphqlQuery({
            connectorId: options.connectorId,
            baseUrl: options.baseUrl,
            path: endpoint.path,
            query: endpoint.graphqlQuery,
            credential: options.credential,
            config: options.config,
          })
        : await restGet({
            connectorId: options.connectorId,
            baseUrl: options.baseUrl,
            path: endpoint.path,
            method: endpoint.method === "HEAD" ? "HEAD" : "GET",
            credential: options.credential,
            config: options.config,
          });

    if (response.statusCode === 401 || response.statusCode === 403) {
      return { ...endpoint, validated: false, statusCode: response.statusCode, latencyMs: response.latencyMs, errorMessage: "Authentication rejected — credential is missing, invalid, or lacks the required scope for this endpoint." };
    }
    if (!response.ok) {
      return { ...endpoint, validated: false, statusCode: response.statusCode, latencyMs: response.latencyMs, errorMessage: `Endpoint responded with HTTP ${response.statusCode}.` };
    }
    if (endpoint.method === "HEAD") {
      return { ...endpoint, validated: true, statusCode: response.statusCode, latencyMs: response.latencyMs };
    }
    if (!isJsonContentType(response.headers)) {
      return { ...endpoint, validated: false, statusCode: response.statusCode, latencyMs: response.latencyMs, errorMessage: "Response was not JSON — cannot be safely consumed by the AI tool layer." };
    }

    const sample = truncatedSample(response.body);
    if (!hasSaneJsonShape(sample)) {
      return { ...endpoint, validated: false, statusCode: response.statusCode, latencyMs: response.latencyMs, responseSample: sample, errorMessage: "Response body did not parse to a JSON object/array." };
    }

    return {
      ...endpoint,
      validated: true,
      statusCode: response.statusCode,
      latencyMs: response.latencyMs,
      responseSample: sample,
      errorMessage: response.latencyMs > SLOW_LATENCY_MS ? `Validated, but slow (${response.latencyMs}ms) — consider raising the connector timeout.` : undefined,
    };
  } catch (err) {
    return { ...endpoint, validated: false, errorMessage: err instanceof Error ? err.message : String(err) };
  }
}

export async function validateEndpoints(endpoints: DiscoveredEndpoint[], options: ValidationOptions): Promise<ValidatedEndpoint[]> {
  const results: ValidatedEndpoint[] = [];
  for (const endpoint of endpoints) {
    results.push(await validateEndpoint(endpoint, options));
  }
  return results;
}
