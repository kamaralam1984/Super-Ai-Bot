// KVL Smart Connector Engine — shared types.
// Every engine module in backend/src/connector/ is pure (no Prisma, no
// direct network calls except through client/readOnlyHttpClient.ts) and
// speaks these types. Persistence lives only in connectorRecord.service.ts.

export type ConnectorType =
  | "WORDPRESS"
  | "WOOCOMMERCE"
  | "SHOPIFY"
  | "MAGENTO"
  | "OPENCART"
  | "PRESTASHOP"
  | "LARAVEL"
  | "GENERIC_REST"
  | "GENERIC_GRAPHQL"
  | "UNIVERSAL_REST"
  | "WEBHOOK"
  // Phase 9 — see docs/CONNECTOR_EXTENSIONS.md. SOAP/legacy-XML enterprise
  // systems (hospital/school/hotel ERPs are frequently SOAP-only) and gRPC
  // services, neither of which fit the REST/GraphQL client already built.
  | "SOAP_API"
  | "GRPC_API"
  | "XML_API";

export type ConnectorAuthMethod =
  | "API_KEY"
  | "BEARER_TOKEN"
  | "JWT"
  | "OAUTH2"
  | "BASIC_AUTH"
  | "SESSION"
  | "CUSTOM_HEADER"
  | "SIGNED_REQUEST"
  | "NONE"
  // Phase 9 additions. Note "HMAC" is deliberately *not* a separate value:
  // SIGNED_REQUEST already is this product's HMAC-SHA256 request-signing
  // implementation (see auth/authManager.ts's `signRequest`) — adding a
  // second enum value for the same signing scheme would be duplicate code
  // with no behavioral difference, not a new capability.
  | "OIDC"
  | "MTLS";

export type ConnectorStatus = "PENDING" | "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "ERROR";

export type ConnectorEventType =
  | "CREATED"
  | "UPDATED"
  | "AUTHENTICATED"
  | "API_CALL"
  | "ERROR"
  | "RETRY"
  | "HEALTH_CHECK"
  | "DISCONNECTED"
  | "RECOVERED";

export type EndpointCategory =
  | "products"
  | "orders"
  | "services"
  | "users"
  | "appointments"
  | "inventory"
  | "categories"
  | "blogs"
  | "faqs"
  | "search"
  | "custom";
// "users" doubles as the customer category (see registry/connectorRegistry.ts's
// keyword list — "user, customer, account, member") rather than adding a
// redundant "customers" value with identical meaning.

/** Retry / rate-limit / circuit-breaker knobs, stored as Connector.config JSON. `soap`/`grpc` are present only for SOAP_API/GRPC_API connectors respectively — see SoapConnectionConfig/GrpcConnectionConfig below. */
export interface ConnectorRuntimeConfig {
  timeoutMs: number;
  maxRedirects: number;
  retryPolicy: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  rateLimit: {
    maxTokens: number;
    refillPerSecond: number;
  };
  circuitBreaker: {
    failureThreshold: number;
    resetTimeoutMs: number;
  };
  soap?: SoapConnectionConfig;
  grpc?: GrpcConnectionConfig;
}

export const DEFAULT_CONNECTOR_CONFIG: ConnectorRuntimeConfig = {
  timeoutMs: 10_000,
  maxRedirects: 3,
  retryPolicy: { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 4_000 },
  rateLimit: { maxTokens: 10, refillPerSecond: 2 },
  circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
};

/**
 * SOAP/gRPC connection config — protocol-specific, not credential material,
 * so it lives on `ConnectorRuntimeConfig` (persisted as `Connector.config`
 * JSON) rather than `RawCredentialInput` (persisted only as vault
 * ciphertext). Both protocols require an administrator-supplied allow-list
 * of the specific read-only operations the AI may invoke — unlike REST
 * (GET/HEAD) or GraphQL (no mutation/subscription keyword), SOAP and gRPC
 * have no universal, protocol-level way to distinguish a read call from a
 * write call, so the allow-list *is* this product's least-privilege
 * enforcement mechanism for these two protocols. See
 * protocols/soapClient.ts / protocols/grpcClient.ts.
 */
export interface SoapConnectionConfig {
  wsdlUrl?: string;
  soapVersion: "1.1" | "1.2";
  targetNamespace: string;
  /** SOAPAction values (or, for SOAP 1.2, operation names) the AI may invoke — every other action on the target service is refused before any request is sent. */
  allowedActions: string[];
}

export interface GrpcConnectionConfig {
  /** Inline .proto source, or a path under the installation's config/ directory — never fetched from the target server itself (no server-reflection auto-discovery; see protocols/grpcClient.ts's module doc for why). */
  protoSource: string;
  protoSourceType: "inline" | "file";
  packageName: string;
  serviceName: string;
  /** Fully-qualified unary RPC method names the AI may invoke — every other method on the service is refused. */
  allowedMethods: string[];
  /** true if the target requires TLS (most production gRPC services do); false for a plaintext (h2c) connection, typically only a local/internal service. */
  useTls: boolean;
}

/** One credential value as supplied by an administrator during connector setup — never persisted in this shape. */
export interface RawCredentialInput {
  authMethod: ConnectorAuthMethod;
  apiKey?: string;
  bearerToken?: string;
  jwt?: string;
  oauth2?: {
    clientId?: string;
    clientSecret?: string;
    tokenUrl?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string; // ISO timestamp
  };
  basicAuth?: { username: string; password: string };
  session?: { cookie: string };
  customHeaders?: Record<string, string>;
  signedRequest?: { keyId: string; secret: string };
  /** OpenID Connect — layers ID-token verification (issuer/audience/signature via the provider's JWKS) on top of an OAuth2 access token. Once verified, the access token is used exactly like OAUTH2's Bearer token for actual API calls; see auth/oidcDiscovery.ts. All fields optional here (like `oauth2` above) — validateCredentialShape() is what enforces which combination is actually required, at runtime, on a value that may legitimately arrive incomplete from an admin form. */
  oidc?: {
    issuerUrl?: string;
    clientId?: string;
    clientSecret?: string;
    accessToken?: string;
    idToken?: string;
    expiresAt?: string;
  };
  /** Mutual TLS — the client certificate itself is the credential; there is no bearer secret. PEM-encoded content (not file paths — paths would be meaningless once vaulted/encrypted and moved). */
  mtls?: {
    clientCertPem: string;
    clientKeyPem: string;
    caCertPem?: string;
  };
}

/** Auth headers/query resolved from a stored credential, ready to attach to an outbound request. */
export interface ResolvedAuth {
  headers: Record<string, string>;
  query?: Record<string, string>;
}

export interface DiscoveredEndpoint {
  category: EndpointCategory;
  path: string;
  method: "GET" | "HEAD" | "POST";
  discoveredVia: "known-pattern" | "openapi" | "graphql-introspection" | "manual";
  graphqlQuery?: string;
}

export interface ValidatedEndpoint extends DiscoveredEndpoint {
  validated: boolean;
  statusCode?: number;
  latencyMs?: number;
  responseSample?: unknown;
  errorMessage?: string;
}

export interface HealthCheckResult {
  status: ConnectorStatus;
  latencyMs: number | null;
  availability: number; // 0-1
  errorMessage?: string;
  checkedAt: string;
}

export interface ClassifiedError {
  category:
    | "auth_expired"
    | "forbidden"
    | "not_found"
    | "rate_limited"
    | "server_error"
    | "network_timeout"
    | "ssl_error"
    | "dns_error"
    | "unknown";
  httpStatus?: number;
  message: string;
  recoverySuggestion: string;
  retryable: boolean;
}

/** The subset of Phase 4's TechnologyReport that Phase 5 actually consumes. */
export interface TechnologyReportSignal {
  websiteUrl: string;
  cms: Array<{ name: string; confidence: number; evidence: string[] }>;
  backendFrameworks: Array<{ name: string; confidence: number; evidence: string[] }>;
  frontendFrameworks: Array<{ name: string; confidence: number; evidence: string[] }>;
  authentication: Array<{ name: string; confidence: number; evidence: string[] }>;
  smartConnectorCompatibility: {
    compatible: boolean;
    recommendedConnectors: string[];
    notes: string[];
  };
}

export interface ConnectorRecommendation {
  connectorType: ConnectorType;
  suggestedName: string;
  baseUrl: string;
  authMethod: ConnectorAuthMethod;
  confidence: number;
  reasons: string[];
}

export interface ConnectorReport {
  connectorId: string;
  detectedPlatform: string;
  connectorType: ConnectorType;
  authMethod: ConnectorAuthMethod;
  baseUrl: string;
  status: ConnectorStatus;
  availableApis: Array<{ category: EndpointCategory; path: string; validated: boolean }>;
  healthScore: number;
  securityScore: number;
  latencyMs: number | null;
  recommendations: string[];
  compatibilityStatus: "compatible" | "partial" | "incompatible";
  generatedAt: string;
  sslCertificate?: SslCertificateInfo | null;
}

/** SSL/TLS certificate validation result for a connector's baseUrl — see validation/apiValidationEngine.ts's `validateSslCertificate`. `null`/absent for a plain-HTTP connector (nothing to validate) rather than a misleading "invalid" result. */
export interface SslCertificateInfo {
  valid: boolean;
  issuer: string | null;
  subject: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysUntilExpiry: number | null;
  selfSigned: boolean;
  errorMessage?: string;
}
