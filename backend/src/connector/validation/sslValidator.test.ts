import { describe, it, expect } from "vitest";
import { isCertificateExpiringSoon, validateSslCertificate } from "./sslValidator";

describe("validateSslCertificate", () => {
  it("returns null for a plain-HTTP baseUrl — nothing to validate", async () => {
    expect(await validateSslCertificate("http://example.com")).toBeNull();
  });

  it("returns an error result for an unparseable baseUrl", async () => {
    const result = await validateSslCertificate("not a url");
    expect(result?.valid).toBe(false);
    expect(result?.errorMessage).toMatch(/not a valid URL/);
  });

  // Real network — badss.com is a purpose-built, stable public test
  // service maintained specifically for exercising TLS certificate
  // validation code against real, deliberately-misconfigured endpoints;
  // widely used across the security community for exactly this.
  describe("real network — badssl.com test endpoints", () => {
    it("reports a valid, trusted certificate for a real, correctly configured HTTPS site", async () => {
      const result = await validateSslCertificate("https://example.com");
      expect(result).not.toBeNull();
      expect(result?.valid).toBe(true);
      expect(result?.issuer).not.toBeNull();
      expect(result?.daysUntilExpiry).toBeGreaterThan(0);
    }, 15_000);

    it("reports a self-signed certificate as untrusted", async () => {
      const result = await validateSslCertificate("https://self-signed.badssl.com");
      expect(result?.valid).toBe(false);
      expect(result?.selfSigned).toBe(true);
    }, 15_000);

    it("reports an expired certificate with a negative daysUntilExpiry", async () => {
      const result = await validateSslCertificate("https://expired.badssl.com");
      expect(result?.valid).toBe(false);
      expect(result?.daysUntilExpiry).toBeLessThan(0);
    }, 15_000);
  });

  it("reports an error rather than hanging for an unreachable host", async () => {
    const result = await validateSslCertificate("https://this-domain-does-not-exist-kvl-test.invalid", 5000);
    expect(result?.valid).toBe(false);
    expect(result?.errorMessage).toBeTruthy();
  }, 10_000);
});

describe("isCertificateExpiringSoon", () => {
  it("is true for an already-expired certificate", () => {
    expect(isCertificateExpiringSoon({ valid: false, issuer: "x", subject: "x", validFrom: null, validTo: null, daysUntilExpiry: -5, selfSigned: false })).toBe(true);
  });

  it("is true for a certificate expiring within the warning window", () => {
    expect(isCertificateExpiringSoon({ valid: true, issuer: "x", subject: "y", validFrom: null, validTo: null, daysUntilExpiry: 10, selfSigned: false })).toBe(true);
  });

  it("is false for a certificate with plenty of time left", () => {
    expect(isCertificateExpiringSoon({ valid: true, issuer: "x", subject: "y", validFrom: null, validTo: null, daysUntilExpiry: 200, selfSigned: false })).toBe(false);
  });

  it("is false when there's no expiry information at all", () => {
    expect(isCertificateExpiringSoon({ valid: false, issuer: null, subject: null, validFrom: null, validTo: null, daysUntilExpiry: null, selfSigned: false })).toBe(false);
  });

  it("respects a custom warning window", () => {
    expect(isCertificateExpiringSoon({ valid: true, issuer: "x", subject: "y", validFrom: null, validTo: null, daysUntilExpiry: 45, selfSigned: false }, 60)).toBe(true);
  });
});
