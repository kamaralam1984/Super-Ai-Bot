// OpenID Connect — discovery-document lookup, JWKS fetch, and ID-token
// verification. Layered on top of OAuth2 (an OIDC access token is used
// exactly like OAUTH2's Bearer token for real API calls — see
// authManager.ts's `resolveAuth`); what OIDC adds is the ability to
// cryptographically verify *who actually issued* the token before
// trusting it, via the provider's published JWKS.
//
// Uses `jose` (a well-audited, standard JWT/JWKS library) rather than
// hand-rolling JWT signature verification — algorithm-confusion and
// JWKS-handling bugs are a well-documented, recurring class of real-world
// auth vulnerabilities, and this is exactly the kind of code where
// "we wrote our own" is the wrong call.
//
// `jose` v6 ships ESM-only ("type": "module", no CJS export condition),
// while this backend compiles to CommonJS — so it's loaded via a dynamic
// `import()` inside each function rather than a static top-level import,
// which TypeScript would otherwise transpile to a `require()` call that
// fails at runtime (`ERR_REQUIRE_ESM`). `import type` for jose's types is
// still used normally at the top of the file — type-only imports are
// erased at compile time and never touch the runtime module system.

import { safeFetch } from "../../scanner/http/safeFetch";
import type { JSONWebKeySet, JWTPayload } from "jose";

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

/**
 * Fetches and validates `${issuerUrl}/.well-known/openid-configuration`.
 * Verifies the document's own `issuer` field matches the URL it was
 * requested from (OIDC Discovery 1.0 §4.3 / RFC 8414 §3.3) — without this
 * check, a network-level attacker could serve a discovery document
 * pointing at a completely different (attacker-controlled) token/JWKS
 * endpoint, and everything downstream would "correctly" verify against
 * the wrong issuer.
 */
export async function discoverOidcConfiguration(issuerUrl: string): Promise<OidcDiscoveryDocument> {
  const wellKnownUrl = new URL("/.well-known/openid-configuration", issuerUrl).toString();
  const response = await safeFetch(wellKnownUrl);
  if (!response.ok) {
    throw new Error(`OIDC discovery document request failed with status ${response.statusCode} at ${wellKnownUrl}`);
  }

  const doc = JSON.parse(response.body.toString("utf-8")) as OidcDiscoveryDocument;
  if (!doc.issuer || !doc.jwks_uri || !doc.token_endpoint) {
    throw new Error(`OIDC discovery document at ${wellKnownUrl} is missing required fields (issuer/jwks_uri/token_endpoint).`);
  }

  const normalizedIssuer = issuerUrl.replace(/\/$/, "");
  const normalizedDocIssuer = doc.issuer.replace(/\/$/, "");
  if (normalizedDocIssuer !== normalizedIssuer) {
    throw new Error(`OIDC discovery document's issuer ("${doc.issuer}") does not match the requested issuer URL ("${issuerUrl}") — refusing to trust it.`);
  }

  return doc;
}

/** Fetches a JWKS document via `safeFetch` (SSRF-guarded, like every other outbound call in this product) rather than letting a JWT library do its own unguarded HTTP fetch — `validateIdToken` below verifies purely against the already-fetched key set, with no network I/O of its own. */
export async function fetchJwks(jwksUri: string): Promise<JSONWebKeySet> {
  const response = await safeFetch(jwksUri);
  if (!response.ok) {
    throw new Error(`JWKS request failed with status ${response.statusCode} at ${jwksUri}`);
  }
  const parsed = JSON.parse(response.body.toString("utf-8")) as JSONWebKeySet;
  if (!Array.isArray(parsed.keys)) {
    throw new Error(`JWKS document at ${jwksUri} did not contain a "keys" array.`);
  }
  return parsed;
}

export interface IdTokenValidationOptions {
  issuer: string;
  audience: string;
}

export interface IdTokenValidationResult {
  valid: boolean;
  claims?: JWTPayload;
  errorMessage?: string;
}

/** Verifies an ID token's signature (against an already-fetched JWKS — see `fetchJwks`) and standard claims (`iss`/`aud`/`exp`). Never trust an ID token's claims before this passes. Pure with respect to I/O (no network calls; `jwks` is supplied by the caller), which also makes it fully unit-testable with a locally generated key pair — no network mocking needed. */
export async function validateIdToken(idToken: string, jwks: JSONWebKeySet, options: IdTokenValidationOptions): Promise<IdTokenValidationResult> {
  try {
    const { createLocalJWKSet, jwtVerify } = await import("jose");
    const keySet = createLocalJWKSet(jwks);
    const { payload } = await jwtVerify(idToken, keySet, { issuer: options.issuer, audience: options.audience });
    return { valid: true, claims: payload };
  } catch (err) {
    return { valid: false, errorMessage: err instanceof Error ? err.message : String(err) };
  }
}
