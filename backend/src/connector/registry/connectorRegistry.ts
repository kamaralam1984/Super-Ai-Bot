// Static registry of connector definitions for every platform the Smart
// Connector Engine supports. Pure data + pure lookup functions — no
// network calls, no Prisma. `apiDiscoveryEngine.ts` walks
// `knownEndpoints` as its first, cheapest discovery pass before falling
// back to universal OpenAPI/GraphQL probing.

import type { ConnectorAuthMethod, ConnectorType, DiscoveredEndpoint } from "../types";

export interface ConnectorDefinition {
  connectorType: ConnectorType;
  displayName: string;
  /** Platform names (as they appear in Phase 4's TechnologyReport cms/backendFrameworks categories) that map to this connector. */
  matchesPlatforms: string[];
  supportedAuthMethods: ConnectorAuthMethod[];
  defaultAuthMethod: ConnectorAuthMethod;
  /** Known, documented read-only endpoint patterns — relative to the site's base URL. */
  knownEndpoints: DiscoveredEndpoint[];
  notes: string[];
}

const wp: DiscoveredEndpoint[] = [
  { category: "blogs", path: "/wp-json/wp/v2/posts", method: "GET", discoveredVia: "known-pattern" },
  { category: "custom", path: "/wp-json/wp/v2/pages", method: "GET", discoveredVia: "known-pattern" },
  { category: "categories", path: "/wp-json/wp/v2/categories", method: "GET", discoveredVia: "known-pattern" },
  { category: "users", path: "/wp-json/wp/v2/users", method: "GET", discoveredVia: "known-pattern" },
  { category: "search", path: "/wp-json/wp/v2/search", method: "GET", discoveredVia: "known-pattern" },
];

const woo: DiscoveredEndpoint[] = [
  { category: "products", path: "/wp-json/wc/v3/products", method: "GET", discoveredVia: "known-pattern" },
  { category: "orders", path: "/wp-json/wc/v3/orders", method: "GET", discoveredVia: "known-pattern" },
  { category: "categories", path: "/wp-json/wc/v3/products/categories", method: "GET", discoveredVia: "known-pattern" },
  { category: "inventory", path: "/wp-json/wc/v3/products?stock_status=instock", method: "GET", discoveredVia: "known-pattern" },
];

const shopify: DiscoveredEndpoint[] = [
  { category: "products", path: "/products.json", method: "GET", discoveredVia: "known-pattern" },
  { category: "categories", path: "/collections.json", method: "GET", discoveredVia: "known-pattern" },
  { category: "products", path: "/admin/api/2024-01/products.json", method: "GET", discoveredVia: "known-pattern" },
  { category: "orders", path: "/admin/api/2024-01/orders.json", method: "GET", discoveredVia: "known-pattern" },
  { category: "inventory", path: "/admin/api/2024-01/inventory_levels.json", method: "GET", discoveredVia: "known-pattern" },
];

const magento: DiscoveredEndpoint[] = [
  { category: "products", path: "/rest/V1/products?searchCriteria[pageSize]=1", method: "GET", discoveredVia: "known-pattern" },
  { category: "orders", path: "/rest/V1/orders?searchCriteria[pageSize]=1", method: "GET", discoveredVia: "known-pattern" },
  { category: "categories", path: "/rest/V1/categories", method: "GET", discoveredVia: "known-pattern" },
];

const prestashop: DiscoveredEndpoint[] = [
  { category: "products", path: "/api/products", method: "GET", discoveredVia: "known-pattern" },
  { category: "orders", path: "/api/orders", method: "GET", discoveredVia: "known-pattern" },
  { category: "users", path: "/api/customers", method: "GET", discoveredVia: "known-pattern" },
  { category: "categories", path: "/api/categories", method: "GET", discoveredVia: "known-pattern" },
];

const opencart: DiscoveredEndpoint[] = [
  { category: "products", path: "/index.php?route=api/product", method: "GET", discoveredVia: "known-pattern" },
  { category: "categories", path: "/index.php?route=api/category", method: "GET", discoveredVia: "known-pattern" },
];

const laravel: DiscoveredEndpoint[] = [
  { category: "custom", path: "/api", method: "GET", discoveredVia: "known-pattern" },
  { category: "custom", path: "/api/health", method: "GET", discoveredVia: "known-pattern" },
];

export const CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  {
    connectorType: "WORDPRESS",
    displayName: "WordPress Connector",
    matchesPlatforms: ["WordPress"],
    supportedAuthMethods: ["NONE", "BASIC_AUTH", "JWT", "API_KEY"],
    defaultAuthMethod: "NONE",
    knownEndpoints: wp,
    notes: ["The core WordPress REST API is public/read-only by default for published content — no credential is required for a basic connection."],
  },
  {
    connectorType: "WOOCOMMERCE",
    displayName: "WooCommerce Connector",
    matchesPlatforms: ["WooCommerce"],
    supportedAuthMethods: ["BASIC_AUTH", "API_KEY"],
    defaultAuthMethod: "API_KEY",
    knownEndpoints: [...wp, ...woo],
    notes: ["WooCommerce's REST API requires a Consumer Key/Secret pair (sent as Basic Auth or query params) even for read-only product/order access."],
  },
  {
    connectorType: "SHOPIFY",
    displayName: "Shopify Connector",
    matchesPlatforms: ["Shopify"],
    supportedAuthMethods: ["NONE", "BEARER_TOKEN", "API_KEY"],
    defaultAuthMethod: "NONE",
    knownEndpoints: shopify,
    notes: ["The Storefront /products.json and /collections.json endpoints are public and need no auth; the Admin API endpoints require an access token with read-only scopes."],
  },
  {
    connectorType: "MAGENTO",
    displayName: "Magento Connector",
    matchesPlatforms: ["Magento"],
    supportedAuthMethods: ["BEARER_TOKEN", "OAUTH2"],
    defaultAuthMethod: "BEARER_TOKEN",
    knownEndpoints: magento,
    notes: ["Magento's REST API requires an integration access token (Bearer) or OAuth1/2 depending on version."],
  },
  {
    connectorType: "OPENCART",
    displayName: "OpenCart Connector",
    matchesPlatforms: ["OpenCart"],
    supportedAuthMethods: ["API_KEY"],
    defaultAuthMethod: "API_KEY",
    knownEndpoints: opencart,
    notes: ["OpenCart does not ship a standard REST API by default; this connector targets the common third-party REST extension route and degrades to Universal REST if absent."],
  },
  {
    connectorType: "PRESTASHOP",
    displayName: "PrestaShop Connector",
    matchesPlatforms: ["PrestaShop"],
    supportedAuthMethods: ["BASIC_AUTH", "API_KEY"],
    defaultAuthMethod: "API_KEY",
    knownEndpoints: prestashop,
    notes: ["PrestaShop's Webservice API key is sent as the Basic Auth username with an empty password."],
  },
  {
    connectorType: "LARAVEL",
    displayName: "Laravel Connector",
    matchesPlatforms: ["Laravel"],
    supportedAuthMethods: ["BEARER_TOKEN", "API_KEY", "SESSION"],
    defaultAuthMethod: "BEARER_TOKEN",
    knownEndpoints: laravel,
    notes: ["Laravel has no single standard API convention — Sanctum/Passport Bearer tokens are the most common read-access pattern; discovery falls back to OpenAPI probing."],
  },
  {
    connectorType: "GENERIC_GRAPHQL",
    displayName: "Universal GraphQL Connector",
    matchesPlatforms: [],
    supportedAuthMethods: ["BEARER_TOKEN", "API_KEY", "CUSTOM_HEADER", "NONE"],
    defaultAuthMethod: "NONE",
    knownEndpoints: [
      { category: "custom", path: "/graphql", method: "POST", discoveredVia: "graphql-introspection" },
      { category: "custom", path: "/api/graphql", method: "POST", discoveredVia: "graphql-introspection" },
    ],
    notes: ["Reads only — every request is a `query` operation validated to contain no `mutation`/`subscription` keyword before it is sent (see client/readOnlyHttpClient.ts)."],
  },
  {
    connectorType: "GENERIC_REST",
    displayName: "REST API Connector",
    matchesPlatforms: ["Next.js", "React", "Node.js", "Express.js", "NestJS", "Django", "FastAPI", "ASP.NET", "Spring Boot"],
    supportedAuthMethods: ["API_KEY", "BEARER_TOKEN", "JWT", "OAUTH2", "BASIC_AUTH", "CUSTOM_HEADER"],
    defaultAuthMethod: "BEARER_TOKEN",
    knownEndpoints: [
      { category: "custom", path: "/api", method: "GET", discoveredVia: "known-pattern" },
      { category: "custom", path: "/api/v1", method: "GET", discoveredVia: "known-pattern" },
    ],
    notes: ["No fixed endpoint convention for a custom backend — relies primarily on OpenAPI/Swagger auto-discovery (FastAPI/ASP.NET/Spring Boot all expose one by convention)."],
  },
  {
    connectorType: "UNIVERSAL_REST",
    displayName: "Universal REST Connector",
    matchesPlatforms: ["ERP", "CRM", "HRMS", "LMS", "Inventory System", "Booking System"],
    supportedAuthMethods: ["API_KEY", "BEARER_TOKEN", "JWT", "OAUTH2", "BASIC_AUTH", "CUSTOM_HEADER", "SIGNED_REQUEST"],
    defaultAuthMethod: "API_KEY",
    knownEndpoints: [],
    notes: ["Enterprise systems (ERP/CRM/HRMS/LMS/Inventory/Booking) have no single standard API shape — this is the deliberate fallback the spec itself names ('Custom Website → Universal REST Connector'); discovery relies entirely on OpenAPI probing and administrator-supplied endpoint hints."],
  },
  {
    connectorType: "WEBHOOK",
    displayName: "Webhook Connector",
    matchesPlatforms: [],
    supportedAuthMethods: ["SIGNED_REQUEST", "CUSTOM_HEADER", "NONE"],
    defaultAuthMethod: "SIGNED_REQUEST",
    knownEndpoints: [],
    notes: ["Inbound-only: the customer system pushes events to KVL rather than KVL polling it. No outbound API discovery applies."],
  },
  // Phase 9 — see docs/CONNECTOR_EXTENSIONS.md. None of these three have
  // known REST-style endpoint patterns (SOAP/gRPC calls go through
  // protocols/soapClient.ts and protocols/grpcClient.ts instead of
  // discovery/apiDiscoveryEngine.ts's known-pattern probing, and XML APIs
  // vary too much by system to guess) — `knownEndpoints: []` here is
  // correct, not incomplete.
  {
    connectorType: "SOAP_API",
    displayName: "SOAP Connector",
    matchesPlatforms: ["Hospital Management System", "School ERP", "Hotel Management System"],
    supportedAuthMethods: ["BASIC_AUTH", "CUSTOM_HEADER", "SIGNED_REQUEST", "MTLS", "NONE"],
    defaultAuthMethod: "BASIC_AUTH",
    knownEndpoints: [],
    notes: [
      "SOAP has no protocol-level GET/HEAD-only restriction — every operation is a POST with an arbitrary body. Least-privilege is enforced by an administrator-supplied allow-list of SOAP actions (SoapConnectionConfig.allowedActions), not the HTTP method.",
      "Common in legacy enterprise systems this product specifically targets — hospital/school/hotel management systems especially.",
    ],
  },
  {
    connectorType: "GRPC_API",
    displayName: "gRPC Connector",
    matchesPlatforms: [],
    supportedAuthMethods: ["BEARER_TOKEN", "MTLS", "NONE"],
    defaultAuthMethod: "MTLS",
    knownEndpoints: [],
    notes: [
      "Requires an administrator-supplied .proto definition — there is no server-reflection-based auto-discovery (many production gRPC servers disable reflection; see protocols/grpcClient.ts's module doc for the full reasoning).",
      "Least-privilege is enforced by an administrator-supplied allow-list of RPC method names (GrpcConnectionConfig.allowedMethods), the same mechanism SOAP uses.",
    ],
  },
  {
    connectorType: "XML_API",
    displayName: "XML API Connector",
    matchesPlatforms: [],
    supportedAuthMethods: ["API_KEY", "BASIC_AUTH", "CUSTOM_HEADER", "NONE"],
    defaultAuthMethod: "API_KEY",
    knownEndpoints: [],
    notes: ["For plain XML-over-HTTP APIs that are neither SOAP-enveloped nor conventionally RESTful — calls still go through client/readOnlyHttpClient.ts's GET/HEAD-only restriction; only the response body format (XML rather than JSON) differs, handled at the AI tool layer's response-formatting step."],
  },
];

export function getConnectorDefinition(connectorType: ConnectorType): ConnectorDefinition {
  const def = CONNECTOR_DEFINITIONS.find((d) => d.connectorType === connectorType);
  if (!def) throw new Error(`Unknown connector type: ${connectorType}`);
  return def;
}

export function findDefinitionForPlatform(platformName: string): ConnectorDefinition | null {
  return CONNECTOR_DEFINITIONS.find((d) => d.matchesPlatforms.includes(platformName)) ?? null;
}
