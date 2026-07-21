// Authentication Manager — turns a decrypted RawCredentialInput into
// request-ready headers/query params, and handles the one legitimate
// exception to "connectors never call the target with anything but
// GET/HEAD": exchanging OAuth2 client credentials for an access token via
// the token endpoint (RFC 6749 §4.4), which is an auth handshake, not a
// call against the target's business API.

import crypto from "node:crypto";
import { safeFetch } from "../../scanner/http/safeFetch";
import { discoverOidcConfiguration } from "./oidcDiscovery";
import type { ConnectorAuthMethod, RawCredentialInput, ResolvedAuth } from "../types";

export interface CredentialValidation {
  valid: boolean;
  errors: string[];
}

/** Validates that a raw credential carries what its declared auth method requires, before it's ever sealed into the vault. */
export function validateCredentialShape(input: RawCredentialInput): CredentialValidation {
  const errors: string[] = [];
  switch (input.authMethod) {
    case "API_KEY":
      if (!input.apiKey) errors.push("apiKey is required for API_KEY auth");
      break;
    case "BEARER_TOKEN":
      if (!input.bearerToken) errors.push("bearerToken is required for BEARER_TOKEN auth");
      break;
    case "JWT":
      if (!input.jwt) errors.push("jwt is required for JWT auth");
      else if (input.jwt.split(".").length !== 3) errors.push("jwt does not look like a valid JWT (expected 3 dot-separated segments)");
      break;
    case "OAUTH2":
      if (!input.oauth2) errors.push("oauth2 config is required for OAUTH2 auth");
      else if (!input.oauth2.accessToken && !(input.oauth2.clientId && input.oauth2.clientSecret && input.oauth2.tokenUrl)) {
        errors.push("oauth2 requires either a pre-obtained accessToken, or clientId+clientSecret+tokenUrl for the client-credentials grant");
      }
      break;
    case "BASIC_AUTH":
      if (!input.basicAuth?.username) errors.push("basicAuth.username is required for BASIC_AUTH");
      break;
    case "SESSION":
      if (!input.session?.cookie) errors.push("session.cookie is required for SESSION auth");
      break;
    case "CUSTOM_HEADER":
      if (!input.customHeaders || Object.keys(input.customHeaders).length === 0) errors.push("customHeaders must have at least one entry for CUSTOM_HEADER auth");
      break;
    case "SIGNED_REQUEST":
      if (!input.signedRequest?.keyId || !input.signedRequest?.secret) errors.push("signedRequest.keyId and signedRequest.secret are both required for SIGNED_REQUEST auth");
      break;
    case "OIDC":
      if (!input.oidc?.issuerUrl) errors.push("oidc.issuerUrl is required for OIDC auth");
      else if (!input.oidc.accessToken && !(input.oidc.clientId && input.oidc.clientSecret)) {
        errors.push("oidc requires either a pre-obtained accessToken, or clientId+clientSecret for the client-credentials grant against the issuer's token endpoint");
      }
      break;
    case "MTLS":
      if (!input.mtls?.clientCertPem) errors.push("mtls.clientCertPem is required for MTLS auth");
      if (!input.mtls?.clientKeyPem) errors.push("mtls.clientKeyPem is required for MTLS auth");
      break;
    case "NONE":
      break;
    default:
      errors.push(`Unknown auth method: ${input.authMethod as string}`);
  }
  return { valid: errors.length === 0, errors };
}

function signRequest(method: string, path: string, keyId: string, secret: string): Record<string, string> {
  const timestamp = new Date().toISOString();
  const signature = crypto.createHmac("sha256", secret).update(`${method}\n${path}\n${timestamp}`).digest("hex");
  return {
    "X-KVL-Key-Id": keyId,
    "X-KVL-Timestamp": timestamp,
    "X-KVL-Signature": signature,
  };
}

/** Resolves auth headers/query for one outbound request. `method`/`path` are only used by SIGNED_REQUEST, which signs over them. */
export function resolveAuth(input: RawCredentialInput, method: string, path: string): ResolvedAuth {
  switch (input.authMethod) {
    case "API_KEY":
      return { headers: { "X-API-Key": input.apiKey ?? "" } };
    case "BEARER_TOKEN":
      return { headers: { Authorization: `Bearer ${input.bearerToken ?? ""}` } };
    case "JWT":
      return { headers: { Authorization: `Bearer ${input.jwt ?? ""}` } };
    case "OAUTH2": {
      if (!input.oauth2?.accessToken) {
        throw new Error("OAuth2 credential has no accessToken resolved — call acquireOAuth2Token() first");
      }
      return { headers: { Authorization: `Bearer ${input.oauth2.accessToken}` } };
    }
    case "BASIC_AUTH": {
      const { username = "", password = "" } = input.basicAuth ?? {};
      const encoded = Buffer.from(`${username}:${password}`, "utf-8").toString("base64");
      return { headers: { Authorization: `Basic ${encoded}` } };
    }
    case "SESSION":
      return { headers: { Cookie: input.session?.cookie ?? "" } };
    case "CUSTOM_HEADER":
      return { headers: { ...(input.customHeaders ?? {}) } };
    case "SIGNED_REQUEST": {
      const { keyId = "", secret = "" } = input.signedRequest ?? {};
      return { headers: signRequest(method, path, keyId, secret) };
    }
    case "OIDC": {
      // Once an OIDC access token has been obtained and its ID token (if
      // any) verified via oidcDiscovery.ts's validateIdToken, the access
      // token authenticates real API calls exactly like OAUTH2's — OIDC's
      // extra step (ID-token verification) already happened during
      // connector setup, not on every request.
      if (!input.oidc?.accessToken) {
        throw new Error("OIDC credential has no accessToken resolved — acquire one via the issuer's token endpoint first.");
      }
      return { headers: { Authorization: `Bearer ${input.oidc.accessToken}` } };
    }
    case "MTLS":
      // The client certificate itself is the credential — it's presented
      // during the TLS handshake (see client/mtlsAgent.ts), not as a
      // request header.
      return { headers: {} };
    case "NONE":
      return { headers: {} };
    default:
      return { headers: {} };
  }
}

export function isOAuth2TokenExpired(input: RawCredentialInput, skewMs = 30_000): boolean {
  const expiresAt = input.oauth2?.expiresAt;
  if (!expiresAt) return false; // no expiry info — assume the caller knows what it's doing
  return Date.parse(expiresAt) - skewMs <= Date.now();
}

interface OAuth2TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * RFC 6749 §4.4 client-credentials grant — a standard, well-known auth
 * handshake, not a call against the target's business data, so it goes
 * through safeFetch (SSRF-guarded) directly rather than the read-only
 * client's GET/HEAD-only restriction.
 */
export async function acquireOAuth2Token(oauth2: NonNullable<RawCredentialInput["oauth2"]>): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: string }> {
  if (!oauth2.tokenUrl || !oauth2.clientId || !oauth2.clientSecret) {
    throw new Error("acquireOAuth2Token requires tokenUrl, clientId, and clientSecret");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: oauth2.clientId,
    client_secret: oauth2.clientSecret,
  }).toString();

  const result = await safeFetch(oauth2.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!result.ok) {
    throw new Error(`OAuth2 token request failed with status ${result.statusCode}`);
  }
  const parsed = JSON.parse(result.body.toString("utf-8")) as OAuth2TokenResponse;
  if (!parsed.access_token) {
    throw new Error("OAuth2 token endpoint response did not include access_token");
  }
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000).toISOString() : undefined,
  };
}

export function authMethodRequiresNetworkHandshake(authMethod: ConnectorAuthMethod): boolean {
  return authMethod === "OAUTH2" || authMethod === "OIDC";
}

export function isOidcTokenExpired(oidc: NonNullable<RawCredentialInput["oidc"]>, skewMs = 30_000): boolean {
  if (!oidc.expiresAt) return false;
  return Date.parse(oidc.expiresAt) - skewMs <= Date.now();
}

/**
 * Discovers the issuer's token endpoint, then runs the RFC 6749 §4.4
 * client-credentials grant against it — OIDC's discovery step layered on
 * top of the same OAuth2 handshake `acquireOAuth2Token` already
 * implements, rather than a second, parallel token-acquisition code path.
 */
export async function acquireOidcAccessToken(oidc: NonNullable<RawCredentialInput["oidc"]>): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: string }> {
  if (!oidc.issuerUrl || !oidc.clientId || !oidc.clientSecret) {
    throw new Error("acquireOidcAccessToken requires issuerUrl, clientId, and clientSecret");
  }
  const discovery = await discoverOidcConfiguration(oidc.issuerUrl);
  return acquireOAuth2Token({ tokenUrl: discovery.token_endpoint, clientId: oidc.clientId, clientSecret: oidc.clientSecret });
}

/** RFC 6749 §6 refresh-token grant — renews an expired access token without re-running the full handshake. */
export async function refreshOAuth2Token(oauth2: NonNullable<RawCredentialInput["oauth2"]>): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: string }> {
  if (!oauth2.tokenUrl || !oauth2.clientId || !oauth2.clientSecret || !oauth2.refreshToken) {
    throw new Error("refreshOAuth2Token requires tokenUrl, clientId, clientSecret, and refreshToken");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: oauth2.refreshToken,
    client_id: oauth2.clientId,
    client_secret: oauth2.clientSecret,
  }).toString();

  const result = await safeFetch(oauth2.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!result.ok) {
    throw new Error(`OAuth2 token refresh failed with status ${result.statusCode}`);
  }
  const parsed = JSON.parse(result.body.toString("utf-8")) as OAuth2TokenResponse;
  if (!parsed.access_token) {
    throw new Error("OAuth2 refresh response did not include access_token");
  }
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? oauth2.refreshToken,
    expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000).toISOString() : undefined,
  };
}
