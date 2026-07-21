import { describe, it, expect, vi, beforeEach } from "vitest";

const safeFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../scanner/http/safeFetch", () => ({ safeFetch: safeFetchMock }));

import { discoverOidcConfiguration, fetchJwks, validateIdToken } from "./oidcDiscovery";

function jsonResponse(body: unknown, ok = true, statusCode = 200) {
  return { ok, statusCode, body: Buffer.from(JSON.stringify(body)), headers: {}, finalUrl: "https://issuer.example.com" };
}

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("discoverOidcConfiguration", () => {
  it("fetches and returns a valid discovery document", async () => {
    safeFetchMock.mockResolvedValue(
      jsonResponse({ issuer: "https://issuer.example.com", authorization_endpoint: "https://issuer.example.com/authorize", token_endpoint: "https://issuer.example.com/token", jwks_uri: "https://issuer.example.com/jwks" })
    );
    const doc = await discoverOidcConfiguration("https://issuer.example.com");
    expect(doc.token_endpoint).toBe("https://issuer.example.com/token");
    expect(safeFetchMock).toHaveBeenCalledWith("https://issuer.example.com/.well-known/openid-configuration");
  });

  it("throws when the response is not ok", async () => {
    safeFetchMock.mockResolvedValue(jsonResponse({}, false, 404));
    await expect(discoverOidcConfiguration("https://issuer.example.com")).rejects.toThrow(/404/);
  });

  it("throws when required fields are missing", async () => {
    safeFetchMock.mockResolvedValue(jsonResponse({ issuer: "https://issuer.example.com" }));
    await expect(discoverOidcConfiguration("https://issuer.example.com")).rejects.toThrow(/missing required fields/);
  });

  it("refuses a discovery document whose issuer doesn't match the requested URL", async () => {
    safeFetchMock.mockResolvedValue(jsonResponse({ issuer: "https://evil.example.com", token_endpoint: "x", jwks_uri: "y" }));
    await expect(discoverOidcConfiguration("https://issuer.example.com")).rejects.toThrow(/does not match/);
  });

  it("tolerates a trailing slash difference between the requested URL and the document's issuer", async () => {
    safeFetchMock.mockResolvedValue(jsonResponse({ issuer: "https://issuer.example.com/", token_endpoint: "x", jwks_uri: "y" }));
    await expect(discoverOidcConfiguration("https://issuer.example.com")).resolves.toBeDefined();
  });
});

describe("fetchJwks", () => {
  it("returns a parsed JWKS document", async () => {
    safeFetchMock.mockResolvedValue(jsonResponse({ keys: [{ kty: "RSA" }] }));
    const jwks = await fetchJwks("https://issuer.example.com/jwks");
    expect(jwks.keys).toHaveLength(1);
  });

  it("throws when the response has no keys array", async () => {
    safeFetchMock.mockResolvedValue(jsonResponse({ notKeys: [] }));
    await expect(fetchJwks("https://issuer.example.com/jwks")).rejects.toThrow(/keys/);
  });

  it("throws when the response is not ok", async () => {
    safeFetchMock.mockResolvedValue(jsonResponse({}, false, 500));
    await expect(fetchJwks("https://issuer.example.com/jwks")).rejects.toThrow(/500/);
  });
});

describe("validateIdToken", () => {
  it("accepts a genuinely valid, correctly signed ID token", async () => {
    const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "test-key";
    publicJwk.alg = "RS256";

    const idToken = await new SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://issuer.example.com")
      .setAudience("kvl-connector")
      .setExpirationTime("10m")
      .sign(privateKey);

    const result = await validateIdToken(idToken, { keys: [publicJwk] }, { issuer: "https://issuer.example.com", audience: "kvl-connector" });
    expect(result.valid).toBe(true);
    expect(result.claims?.sub).toBe("user-123");
  });

  it("rejects a token signed by a key not in the JWKS", async () => {
    const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
    const { privateKey } = await generateKeyPair("RS256");
    const { publicKey: otherPublicKey } = await generateKeyPair("RS256");
    const otherJwk = await exportJWK(otherPublicKey);
    otherJwk.kid = "wrong-key";
    otherJwk.alg = "RS256";

    const idToken = await new SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://issuer.example.com")
      .setAudience("kvl-connector")
      .setExpirationTime("10m")
      .sign(privateKey);

    const result = await validateIdToken(idToken, { keys: [otherJwk] }, { issuer: "https://issuer.example.com", audience: "kvl-connector" });
    expect(result.valid).toBe(false);
  });

  it("rejects a token with the wrong issuer", async () => {
    const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "test-key";
    publicJwk.alg = "RS256";

    const idToken = await new SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://wrong-issuer.example.com")
      .setAudience("kvl-connector")
      .setExpirationTime("10m")
      .sign(privateKey);

    const result = await validateIdToken(idToken, { keys: [publicJwk] }, { issuer: "https://issuer.example.com", audience: "kvl-connector" });
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toMatch(/iss/i);
  });

  it("rejects an expired token", async () => {
    const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "test-key";
    publicJwk.alg = "RS256";

    const idToken = await new SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://issuer.example.com")
      .setAudience("kvl-connector")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(privateKey);

    const result = await validateIdToken(idToken, { keys: [publicJwk] }, { issuer: "https://issuer.example.com", audience: "kvl-connector" });
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toMatch(/exp/i);
  });

  it("rejects a malformed token string", async () => {
    const result = await validateIdToken("not.a.jwt", { keys: [] }, { issuer: "https://issuer.example.com", audience: "kvl-connector" });
    expect(result.valid).toBe(false);
  });
});
