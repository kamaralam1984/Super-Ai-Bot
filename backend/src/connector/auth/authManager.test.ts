import { describe, it, expect } from "vitest";
import { validateCredentialShape, resolveAuth, isOAuth2TokenExpired, isOidcTokenExpired, acquireOAuth2Token, authMethodRequiresNetworkHandshake } from "./authManager";

describe("validateCredentialShape", () => {
  it("accepts a well-formed API key credential", () => {
    expect(validateCredentialShape({ authMethod: "API_KEY", apiKey: "k" }).valid).toBe(true);
  });

  it("rejects a missing API key", () => {
    const result = validateCredentialShape({ authMethod: "API_KEY" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/apiKey/);
  });

  it("rejects a JWT that doesn't have 3 segments", () => {
    const result = validateCredentialShape({ authMethod: "JWT", jwt: "not-a-real-jwt" });
    expect(result.valid).toBe(false);
  });

  it("accepts a well-formed JWT shape", () => {
    const result = validateCredentialShape({ authMethod: "JWT", jwt: "aaa.bbb.ccc" });
    expect(result.valid).toBe(true);
  });

  it("accepts OAuth2 with a pre-obtained access token", () => {
    expect(validateCredentialShape({ authMethod: "OAUTH2", oauth2: { accessToken: "tok" } }).valid).toBe(true);
  });

  it("accepts OAuth2 with client-credentials fields", () => {
    expect(validateCredentialShape({ authMethod: "OAUTH2", oauth2: { clientId: "id", clientSecret: "secret", tokenUrl: "https://example.com/token" } }).valid).toBe(true);
  });

  it("rejects OAuth2 with neither an access token nor client-credentials fields", () => {
    expect(validateCredentialShape({ authMethod: "OAUTH2", oauth2: {} }).valid).toBe(false);
  });

  it("rejects SIGNED_REQUEST missing keyId/secret", () => {
    expect(validateCredentialShape({ authMethod: "SIGNED_REQUEST" }).valid).toBe(false);
  });

  it("accepts OIDC with a pre-obtained access token", () => {
    expect(validateCredentialShape({ authMethod: "OIDC", oidc: { issuerUrl: "https://issuer.example.com", accessToken: "tok" } }).valid).toBe(true);
  });

  it("accepts OIDC with client-credentials fields", () => {
    expect(validateCredentialShape({ authMethod: "OIDC", oidc: { issuerUrl: "https://issuer.example.com", clientId: "id", clientSecret: "secret" } }).valid).toBe(true);
  });

  it("rejects OIDC missing issuerUrl", () => {
    expect(validateCredentialShape({ authMethod: "OIDC", oidc: { accessToken: "tok" } }).valid).toBe(false);
  });

  it("rejects OIDC with neither an access token nor client-credentials fields", () => {
    expect(validateCredentialShape({ authMethod: "OIDC", oidc: { issuerUrl: "https://issuer.example.com" } }).valid).toBe(false);
  });

  it("accepts a well-formed MTLS credential", () => {
    expect(validateCredentialShape({ authMethod: "MTLS", mtls: { clientCertPem: "-----BEGIN CERTIFICATE-----", clientKeyPem: "-----BEGIN PRIVATE KEY-----" } }).valid).toBe(true);
  });

  it("rejects MTLS missing the client certificate or key", () => {
    expect(validateCredentialShape({ authMethod: "MTLS", mtls: { clientCertPem: "cert", clientKeyPem: "" } }).valid).toBe(false);
    expect(validateCredentialShape({ authMethod: "MTLS" }).valid).toBe(false);
  });

  it("accepts NONE with no fields", () => {
    expect(validateCredentialShape({ authMethod: "NONE" }).valid).toBe(true);
  });
});

describe("resolveAuth", () => {
  it("builds an X-API-Key header for API_KEY", () => {
    const auth = resolveAuth({ authMethod: "API_KEY", apiKey: "abc" }, "GET", "/products");
    expect(auth.headers["X-API-Key"]).toBe("abc");
  });

  it("builds a Bearer Authorization header for BEARER_TOKEN", () => {
    const auth = resolveAuth({ authMethod: "BEARER_TOKEN", bearerToken: "tok123" }, "GET", "/orders");
    expect(auth.headers.Authorization).toBe("Bearer tok123");
  });

  it("builds a Base64 Basic Authorization header", () => {
    const auth = resolveAuth({ authMethod: "BASIC_AUTH", basicAuth: { username: "ck_test", password: "cs_test" } }, "GET", "/products");
    const decoded = Buffer.from(auth.headers.Authorization.replace("Basic ", ""), "base64").toString("utf-8");
    expect(decoded).toBe("ck_test:cs_test");
  });

  it("PrestaShop-style Basic auth (username-only key, empty password) round-trips correctly", () => {
    const auth = resolveAuth({ authMethod: "BASIC_AUTH", basicAuth: { username: "PS_WEBSERVICE_KEY", password: "" } }, "GET", "/api/products");
    const decoded = Buffer.from(auth.headers.Authorization.replace("Basic ", ""), "base64").toString("utf-8");
    expect(decoded).toBe("PS_WEBSERVICE_KEY:");
  });

  it("passes through custom headers verbatim", () => {
    const auth = resolveAuth({ authMethod: "CUSTOM_HEADER", customHeaders: { "X-Tenant-Id": "42", "X-Env": "prod" } }, "GET", "/");
    expect(auth.headers).toEqual({ "X-Tenant-Id": "42", "X-Env": "prod" });
  });

  it("SIGNED_REQUEST produces a deterministic-length HMAC signature bound to method+path", () => {
    const cred = { authMethod: "SIGNED_REQUEST" as const, signedRequest: { keyId: "key1", secret: "s3cr3t" } };
    const authA = resolveAuth(cred, "GET", "/products");
    const authB = resolveAuth(cred, "GET", "/orders");
    expect(authA.headers["X-KVL-Key-Id"]).toBe("key1");
    expect(authA.headers["X-KVL-Signature"]).toHaveLength(64); // hex sha256
    expect(authA.headers["X-KVL-Signature"]).not.toBe(authB.headers["X-KVL-Signature"]); // different path -> different signature
  });

  it("throws when resolving OAuth2 auth without a resolved access token", () => {
    expect(() => resolveAuth({ authMethod: "OAUTH2", oauth2: { clientId: "x" } }, "GET", "/")).toThrow();
  });

  it("returns empty headers for NONE", () => {
    expect(resolveAuth({ authMethod: "NONE" }, "GET", "/")).toEqual({ headers: {} });
  });

  it("resolves OIDC to a Bearer header once an access token is present", () => {
    const auth = resolveAuth({ authMethod: "OIDC", oidc: { issuerUrl: "https://issuer.example.com", accessToken: "id-tok-123" } }, "GET", "/");
    expect(auth.headers.Authorization).toBe("Bearer id-tok-123");
  });

  it("throws when resolving OIDC auth without a resolved access token", () => {
    expect(() => resolveAuth({ authMethod: "OIDC", oidc: { issuerUrl: "https://issuer.example.com" } }, "GET", "/")).toThrow();
  });

  it("returns empty headers for MTLS — the certificate authenticates at the TLS layer, not via a header", () => {
    expect(resolveAuth({ authMethod: "MTLS", mtls: { clientCertPem: "cert", clientKeyPem: "key" } }, "GET", "/")).toEqual({ headers: {} });
  });
});

describe("isOAuth2TokenExpired", () => {
  it("is false when there's no expiresAt", () => {
    expect(isOAuth2TokenExpired({ authMethod: "OAUTH2", oauth2: { accessToken: "t" } })).toBe(false);
  });

  it("is true for a past expiresAt", () => {
    expect(isOAuth2TokenExpired({ authMethod: "OAUTH2", oauth2: { accessToken: "t", expiresAt: new Date(Date.now() - 60_000).toISOString() } })).toBe(true);
  });

  it("is false for a future expiresAt beyond the skew window", () => {
    expect(isOAuth2TokenExpired({ authMethod: "OAUTH2", oauth2: { accessToken: "t", expiresAt: new Date(Date.now() + 600_000).toISOString() } })).toBe(false);
  });
});

describe("isOidcTokenExpired", () => {
  it("is false when there's no expiresAt", () => {
    expect(isOidcTokenExpired({ issuerUrl: "https://issuer.example.com", accessToken: "t" })).toBe(false);
  });

  it("is true for a past expiresAt", () => {
    expect(isOidcTokenExpired({ issuerUrl: "https://issuer.example.com", accessToken: "t", expiresAt: new Date(Date.now() - 60_000).toISOString() })).toBe(true);
  });

  it("is false for a future expiresAt beyond the skew window", () => {
    expect(isOidcTokenExpired({ issuerUrl: "https://issuer.example.com", accessToken: "t", expiresAt: new Date(Date.now() + 600_000).toISOString() })).toBe(false);
  });
});

describe("authMethodRequiresNetworkHandshake", () => {
  it("is true for OAUTH2 and OIDC", () => {
    expect(authMethodRequiresNetworkHandshake("OAUTH2")).toBe(true);
    expect(authMethodRequiresNetworkHandshake("OIDC")).toBe(true);
  });

  it("is false for every other auth method", () => {
    for (const method of ["API_KEY", "BEARER_TOKEN", "JWT", "BASIC_AUTH", "SESSION", "CUSTOM_HEADER", "SIGNED_REQUEST", "MTLS", "NONE"] as const) {
      expect(authMethodRequiresNetworkHandshake(method)).toBe(false);
    }
  });
});

// Real-network: postman-echo.com is a real, public HTTP-echo test service
// (chosen over httpbin.org, which proved slow and inconsistent — several
// requests took 3-5s+ during testing here, occasionally exceeding
// safeFetch's 10s timeout; postman-echo.com consistently responded in
// under half a second). It has no OAuth2 token endpoint, so POSTing our
// client-credentials request there and getting back its own echoed JSON
// (no access_token field) is a genuine test of acquireOAuth2Token's error
// handling against a real server's real response shape — not a mock.
describe("acquireOAuth2Token — real network", () => {
  it("throws a clear error when the token endpoint doesn't return access_token", async () => {
    await expect(
      acquireOAuth2Token({ tokenUrl: "https://postman-echo.com/post", clientId: "id", clientSecret: "secret" })
    ).rejects.toThrow(/access_token/);
  }, 15_000);

  it("throws when required oauth2 fields are missing", async () => {
    await expect(acquireOAuth2Token({})).rejects.toThrow(/requires/);
  });
});
