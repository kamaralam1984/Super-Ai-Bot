// API Discovery Engine — builds an endpoint inventory for a connector via
// three passes, cheapest first:
//   1. Known-pattern probing: the registry's documented endpoints for this
//      connector type (e.g. WooCommerce's /wp-json/wc/v3/products).
//   2. Universal OpenAPI/Swagger discovery: many modern backends (FastAPI,
//      ASP.NET, Spring Boot, and plenty of hand-rolled APIs) expose a
//      machine-readable spec at a handful of conventional paths — when
//      present, this is a far more reliable source of truth than guessing.
//   3. GraphQL introspection: a standard, publicly documented GraphQL
//      feature (not a security bypass) used only to confirm a `/graphql`
//      endpoint exists and enumerate its query fields — never used to
//      probe for hidden mutations.

import { restGet, graphqlQuery } from "../client/readOnlyHttpClient";
import { getConnectorDefinition } from "../registry/connectorRegistry";
import type { ConnectorRuntimeConfig, ConnectorType, DiscoveredEndpoint, EndpointCategory, RawCredentialInput } from "../types";

// A real, versioned reference API (Swagger's own Petstore demo) serves its
// spec at /api/v3/openapi.json rather than any unversioned path — real-world
// testing against it caught the original list only covering unversioned
// conventions, missing the very common "API mounted under /api/vN/" pattern.
const OPENAPI_PROBE_PATHS = [
  "/openapi.json",
  "/swagger.json",
  "/swagger/v1/swagger.json",
  "/v3/api-docs",
  "/.well-known/openapi.json",
  "/api/v3/openapi.json",
  "/api/v2/openapi.json",
  "/api/v1/openapi.json",
  "/api/openapi.json",
  "/api/swagger.json",
];
const GRAPHQL_PROBE_PATHS = ["/graphql", "/api/graphql", "/graphql/v1"];
const INTROSPECTION_QUERY = "query IntrospectionProbe { __schema { queryType { name } } }";

const CATEGORY_KEYWORDS: Array<[EndpointCategory, string[]]> = [
  ["products", ["product", "item", "sku"]],
  ["orders", ["order", "purchase", "transaction"]],
  ["services", ["service", "offering"]],
  ["users", ["user", "customer", "account", "member"]],
  ["appointments", ["appointment", "booking", "reservation", "schedule"]],
  ["inventory", ["inventory", "stock", "warehouse"]],
  ["categories", ["categor", "collection", "taxonomy"]],
  ["blogs", ["blog", "post", "article", "news"]],
  ["faqs", ["faq", "question"]],
  ["search", ["search", "query"]],
];

function categorizeFromPath(path: string): EndpointCategory {
  const lower = path.toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return category;
  }
  return "custom";
}

interface OpenApiDoc {
  openapi?: string;
  swagger?: string;
  paths?: Record<string, Record<string, unknown>>;
}

const MAX_OPENAPI_ENDPOINTS = 25;

function extractGetEndpointsFromOpenApi(doc: OpenApiDoc): DiscoveredEndpoint[] {
  if (!doc.paths || (!doc.openapi && !doc.swagger)) return [];
  const endpoints: DiscoveredEndpoint[] = [];
  for (const [path, operations] of Object.entries(doc.paths)) {
    if (endpoints.length >= MAX_OPENAPI_ENDPOINTS) break;
    if (!operations || typeof operations !== "object" || !("get" in operations)) continue;
    endpoints.push({ category: categorizeFromPath(path), path, method: "GET", discoveredVia: "openapi" });
  }
  return endpoints;
}

export interface DiscoveryOptions {
  connectorId: string;
  connectorType: ConnectorType;
  baseUrl: string;
  credential: RawCredentialInput;
  config: ConnectorRuntimeConfig;
}

export interface DiscoveryResult {
  discovered: DiscoveredEndpoint[];
  probedPaths: string[];
  openApiSpecFound: boolean;
  graphqlEndpointFound: boolean;
}

export async function discoverEndpoints(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const definition = getConnectorDefinition(options.connectorType);
  const discovered = new Map<string, DiscoveredEndpoint>(); // keyed by path — dedupes known-pattern vs OpenAPI overlap
  const probedPaths: string[] = [];

  // Pass 1: known-pattern endpoints for this connector type.
  for (const candidate of definition.knownEndpoints) {
    if (candidate.method === "POST") continue; // GraphQL entries are handled in pass 3
    probedPaths.push(candidate.path);
    try {
      const response = await restGet({
        connectorId: options.connectorId,
        baseUrl: options.baseUrl,
        path: candidate.path,
        credential: options.credential,
        config: options.config,
      });
      // A 401/403 still proves the endpoint exists (just gated) — validation decides accessibility, discovery only decides existence.
      if (response.statusCode !== 404 && response.statusCode < 500) {
        discovered.set(candidate.path, candidate);
      }
    } catch {
      // Unreachable — not discovered, not fatal to the overall scan.
    }
  }

  // Pass 2: universal OpenAPI/Swagger discovery.
  let openApiSpecFound = false;
  for (const specPath of OPENAPI_PROBE_PATHS) {
    probedPaths.push(specPath);
    try {
      const response = await restGet({
        connectorId: options.connectorId,
        baseUrl: options.baseUrl,
        path: specPath,
        credential: options.credential,
        config: options.config,
      });
      if (!response.ok) continue;
      const doc = JSON.parse(response.body.toString("utf-8")) as OpenApiDoc;
      const endpoints = extractGetEndpointsFromOpenApi(doc);
      if (endpoints.length > 0) {
        openApiSpecFound = true;
        for (const endpoint of endpoints) discovered.set(endpoint.path, endpoint);
        break; // first valid spec found wins — no need to keep probing
      }
    } catch {
      // Not an OpenAPI doc at this path, or unreachable — try the next candidate.
    }
  }

  // Pass 3: GraphQL introspection (query-only — see readOnlyHttpClient's mutation guard).
  let graphqlEndpointFound = false;
  if (options.connectorType === "GENERIC_GRAPHQL") {
    for (const path of GRAPHQL_PROBE_PATHS) {
      probedPaths.push(path);
      try {
        const response = await graphqlQuery({
          connectorId: options.connectorId,
          baseUrl: options.baseUrl,
          path,
          query: INTROSPECTION_QUERY,
          credential: options.credential,
          config: options.config,
        });
        if (!response.ok) continue;
        const parsed = JSON.parse(response.body.toString("utf-8")) as { data?: { __schema?: { queryType?: { name?: string } } } };
        if (parsed.data?.__schema?.queryType?.name) {
          graphqlEndpointFound = true;
          discovered.set(path, { category: "custom", path, method: "POST", discoveredVia: "graphql-introspection", graphqlQuery: INTROSPECTION_QUERY });
          break;
        }
      } catch {
        // Not a GraphQL endpoint at this path, or unreachable.
      }
    }
  }

  return {
    discovered: [...discovered.values()],
    probedPaths,
    openApiSpecFound,
    graphqlEndpointFound,
  };
}
