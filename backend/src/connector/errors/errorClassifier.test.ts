import { describe, it, expect } from "vitest";
import { classifyHttpStatus, classifyNetworkError, classifyError } from "./errorClassifier";
import { SsrfBlockedError } from "../../scanner/http/safeFetch";

describe("classifyHttpStatus", () => {
  it("classifies 401 as auth_expired, not retryable", () => {
    const c = classifyHttpStatus(401);
    expect(c.category).toBe("auth_expired");
    expect(c.retryable).toBe(false);
  });

  it("classifies 403 as forbidden", () => {
    expect(classifyHttpStatus(403).category).toBe("forbidden");
  });

  it("classifies 404 as not_found", () => {
    expect(classifyHttpStatus(404).category).toBe("not_found");
  });

  it("classifies 429 as rate_limited and retryable", () => {
    const c = classifyHttpStatus(429);
    expect(c.category).toBe("rate_limited");
    expect(c.retryable).toBe(true);
  });

  it("classifies 500-599 as server_error and retryable", () => {
    expect(classifyHttpStatus(500).category).toBe("server_error");
    expect(classifyHttpStatus(503).retryable).toBe(true);
  });

  it("classifies an uncategorized status as unknown", () => {
    expect(classifyHttpStatus(418).category).toBe("unknown");
  });

  it("includes context in the message when provided", () => {
    expect(classifyHttpStatus(404, "products endpoint").message).toContain("products endpoint");
  });
});

describe("classifyNetworkError", () => {
  it("classifies a timeout error code as network_timeout, retryable", () => {
    const err = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
    const c = classifyNetworkError(err);
    expect(c.category).toBe("network_timeout");
    expect(c.retryable).toBe(true);
  });

  it("classifies a DNS resolution failure as dns_error, not retryable", () => {
    const err = Object.assign(new Error("getaddrinfo ENOTFOUND nonexistent.example"), { code: "ENOTFOUND" });
    expect(classifyNetworkError(err).category).toBe("dns_error");
  });

  it("classifies a certificate error as ssl_error", () => {
    const err = Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });
    expect(classifyNetworkError(err).category).toBe("ssl_error");
  });

  it("classifies an SsrfBlockedError distinctly and non-retryable", () => {
    const err = new SsrfBlockedError("internal.local", "10.0.0.5");
    const c = classifyNetworkError(err);
    expect(c.retryable).toBe(false);
    expect(c.message).toContain("unsafe destination");
  });

  it("falls back to unknown for an unrecognized error", () => {
    expect(classifyNetworkError(new Error("something bizarre happened")).category).toBe("unknown");
  });
});

describe("classifyError", () => {
  it("dispatches to classifyHttpStatus when statusCode is present", () => {
    expect(classifyError({ statusCode: 401 }).category).toBe("auth_expired");
  });

  it("dispatches to classifyNetworkError when error is present", () => {
    expect(classifyError({ error: Object.assign(new Error("x"), { code: "ETIMEDOUT" }) }).category).toBe("network_timeout");
  });

  it("returns unknown with no input", () => {
    expect(classifyError({}).category).toBe("unknown");
  });
});
