import { describe, it, expect } from "vitest";
import { safeFetch, SsrfBlockedError } from "./safeFetch";
import { isPrivateOrReservedIPv4, isPrivateOrReservedIPv6 } from "./ipSafety";

/**
 * These hit real network/DNS resolution deliberately — the bugs this file
 * guards against (literal-IP bypass of the lookup hook, the options.all
 * Happy-Eyeballs callback-shape mismatch) were only caught by actually
 * calling safeFetch end-to-end, not by unit-testing isUnsafeAddress alone.
 */
describe("safeFetch SSRF protection", () => {
  it("allows a real public site", async () => {
    const res = await safeFetch("https://example.com", { timeoutMs: 8000 });
    expect(res.statusCode).toBe(200);
  }, 15000);

  it("blocks a hostname that resolves to loopback", async () => {
    await expect(safeFetch("http://localhost/", { timeoutMs: 4000 })).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it.each([
    ["loopback IPv4 literal", "http://127.0.0.1/"],
    ["private 10.x literal", "http://10.0.0.1/"],
    ["private 192.168.x literal", "http://192.168.1.1/"],
    ["cloud metadata endpoint", "http://169.254.169.254/latest/meta-data/"],
    ["private 172.16.x literal", "http://172.16.0.1/"],
    ["IPv6 loopback literal", "http://[::1]/"],
  ])("blocks literal-IP URL: %s", async (_label, url) => {
    await expect(safeFetch(url, { timeoutMs: 4000 })).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe("ipSafety range checks", () => {
  it("flags RFC1918 and loopback IPv4 ranges", () => {
    expect(isPrivateOrReservedIPv4("10.1.2.3")).toBe(true);
    expect(isPrivateOrReservedIPv4("172.20.0.1")).toBe(true);
    expect(isPrivateOrReservedIPv4("192.168.50.1")).toBe(true);
    expect(isPrivateOrReservedIPv4("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIPv4("169.254.169.254")).toBe(true);
  });

  it("does not flag ordinary public IPv4 addresses", () => {
    expect(isPrivateOrReservedIPv4("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIPv4("1.1.1.1")).toBe(false);
  });

  it("flags IPv6 loopback and unique-local ranges", () => {
    expect(isPrivateOrReservedIPv6("::1")).toBe(true);
    expect(isPrivateOrReservedIPv6("fe80::1")).toBe(true);
    expect(isPrivateOrReservedIPv6("fd00::1")).toBe(true);
    expect(isPrivateOrReservedIPv6("::ffff:127.0.0.1")).toBe(true);
  });
});
