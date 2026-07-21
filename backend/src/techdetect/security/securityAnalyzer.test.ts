import { describe, it, expect } from "vitest";
import { analyzeSecurity } from "./securityAnalyzer";
import { buildSignals } from "../testFixtures";
import { collectSignals } from "../signals/signalCollector";

function findingFor(result: ReturnType<typeof analyzeSecurity>, check: string) {
  const finding = result.findings.find((f) => f.check === check);
  if (!finding) throw new Error(`no finding for check "${check}"`);
  return finding;
}

describe("analyzeSecurity", () => {
  it("fails HTTPS critically when the site is served over plain HTTP", () => {
    const result = analyzeSecurity(buildSignals({ finalUrl: "http://example.test" }));
    const finding = findingFor(result, "HTTPS");
    expect(finding.passed).toBe(false);
    expect(finding.severity).toBe("critical");
  });

  it("does not check SSL Certificate at all when the site isn't HTTPS", () => {
    const result = analyzeSecurity(buildSignals({ finalUrl: "http://example.test" }));
    expect(result.findings.some((f) => f.check === "SSL Certificate")).toBe(false);
  });

  it("passes SSL Certificate when TLS was reachable and authorized", () => {
    const result = analyzeSecurity(
      buildSignals({ finalUrl: "https://example.test", tls: { reachable: true, authorized: true, issuer: "Let's Encrypt", expiresAt: "2027-01-01T00:00:00Z", error: null, protocol: "TLSv1.3" } })
    );
    expect(findingFor(result, "SSL Certificate").passed).toBe(true);
  });

  it("fails SSL Certificate when the handshake succeeded but the cert isn't trusted", () => {
    const result = analyzeSecurity(
      buildSignals({ finalUrl: "https://example.test", tls: { reachable: true, authorized: false, issuer: null, expiresAt: null, error: "self signed certificate", protocol: "TLSv1.2" } })
    );
    expect(findingFor(result, "SSL Certificate").passed).toBe(false);
  });

  it("treats HSTS max-age=0 as disabled, not enabled — real bug found against books.toscrape.com", () => {
    const result = analyzeSecurity(buildSignals({ finalUrl: "https://example.test", headers: { "strict-transport-security": "max-age=0; includeSubDomains; preload" } }));
    const finding = findingFor(result, "HSTS");
    expect(finding.passed).toBe(false);
    expect(finding.detail).toContain("disables HSTS");
  });

  it("passes HSTS with a real positive max-age", () => {
    const result = analyzeSecurity(buildSignals({ finalUrl: "https://example.test", headers: { "strict-transport-security": "max-age=63072000; includeSubDomains" } }));
    expect(findingFor(result, "HSTS").passed).toBe(true);
  });

  it("passes Content-Security-Policy only when the header is present", () => {
    const withCsp = analyzeSecurity(buildSignals({ headers: { "content-security-policy": "default-src 'self'" } }));
    expect(findingFor(withCsp, "Content-Security-Policy").passed).toBe(true);
    const withoutCsp = analyzeSecurity(buildSignals({ headers: {} }));
    expect(findingFor(withoutCsp, "Content-Security-Policy").passed).toBe(false);
  });

  it("passes clickjacking protection via X-Frame-Options or CSP frame-ancestors", () => {
    const viaHeader = analyzeSecurity(buildSignals({ headers: { "x-frame-options": "DENY" } }));
    expect(findingFor(viaHeader, "Clickjacking Protection (X-Frame-Options / CSP frame-ancestors)").passed).toBe(true);
    const viaCsp = analyzeSecurity(buildSignals({ headers: { "content-security-policy": "frame-ancestors 'none'" } }));
    expect(findingFor(viaCsp, "Clickjacking Protection (X-Frame-Options / CSP frame-ancestors)").passed).toBe(true);
  });

  it("flags a dangerous CORS wildcard+credentials misconfiguration but not a wildcard alone", () => {
    const misconfigured = analyzeSecurity(buildSignals({ headers: { "access-control-allow-origin": "*", "access-control-allow-credentials": "true" } }));
    expect(findingFor(misconfigured, "CORS").passed).toBe(false);

    const safeWildcard = analyzeSecurity(buildSignals({ headers: { "access-control-allow-origin": "*" } }));
    expect(findingFor(safeWildcard, "CORS").passed).toBe(true);
  });

  it("does not report a CORS finding at all when no CORS headers are present", () => {
    const result = analyzeSecurity(buildSignals({ headers: {} }));
    expect(result.findings.some((f) => f.check === "CORS")).toBe(false);
  });

  it("flags cookies missing Secure/HttpOnly flags", () => {
    const result = analyzeSecurity(buildSignals({ cookies: ["session=abc123; Path=/"] }));
    expect(findingFor(result, "Cookie Policy").passed).toBe(false);
  });

  it("passes cookie policy when every cookie sets Secure and HttpOnly", () => {
    const result = analyzeSecurity(buildSignals({ cookies: ["session=abc123; Path=/; Secure; HttpOnly; SameSite=Lax"] }));
    expect(findingFor(result, "Cookie Policy").passed).toBe(true);
  });

  it("does not report a cookie policy finding when no cookies are set", () => {
    const result = analyzeSecurity(buildSignals({ cookies: [] }));
    expect(result.findings.some((f) => f.check === "Cookie Policy")).toBe(false);
  });

  it("produces a 0-100 score and a perfect score for a fully-hardened site", () => {
    const result = analyzeSecurity(
      buildSignals({
        finalUrl: "https://example.test",
        tls: { reachable: true, authorized: true, issuer: "Let's Encrypt", expiresAt: "2027-01-01T00:00:00Z", error: null, protocol: "TLSv1.3" },
        headers: {
          "strict-transport-security": "max-age=63072000",
          "content-security-policy": "default-src 'self'",
          "x-frame-options": "DENY",
          "x-content-type-options": "nosniff",
          "x-xss-protection": "1; mode=block",
        },
      })
    );
    expect(result.score).toBe(100);
  });

  it("produces a low score for a site with no security controls at all", () => {
    const result = analyzeSecurity(buildSignals({ finalUrl: "http://example.test", headers: {} }));
    expect(result.score).toBeLessThan(30);
  });
});

describe("analyzeSecurity — real websites", () => {
  it("correctly identifies the disabled HSTS header on a real live site", async () => {
    const signals = await collectSignals("https://books.toscrape.com");
    const result = analyzeSecurity(signals);
    const hsts = findingFor(result, "HSTS");
    expect(hsts.passed).toBe(false);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
  }, 30000);
});
