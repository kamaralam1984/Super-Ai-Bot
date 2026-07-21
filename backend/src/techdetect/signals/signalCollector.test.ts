import { describe, it, expect } from "vitest";
import { collectSignals } from "./signalCollector";

describe("collectSignals (real network)", () => {
  it("gathers a full signal bundle from a real, reachable site", async () => {
    const signals = await collectSignals("https://example.com");

    expect(signals.statusCode).toBe(200);
    expect(signals.finalUrl).toContain("example.com");
    expect(signals.html.length).toBeGreaterThan(0);
    expect(signals.headers).toBeTruthy();
  }, 30000);

  it("resolves nameservers by walking up to the apex domain when the exact host has none of its own", async () => {
    // books.toscrape.com itself has no NS records (verified: ENODATA) —
    // only the apex toscrape.com does (AWS Route53). A naive exact-host
    // lookup would silently return [] for the overwhelming majority of
    // real sites, which mostly serve from a subdomain (www., or none at
    // all beyond the apex being the actual delegation point).
    const signals = await collectSignals("https://books.toscrape.com");
    expect(signals.dns.nameservers.length).toBeGreaterThan(0);
    expect(signals.dns.nameservers.some((ns) => ns.includes("awsdns"))).toBe(true);
  }, 30000);

  it("performs a real TLS handshake and reports real certificate info for an https site", async () => {
    const signals = await collectSignals("https://example.com");
    expect(signals.tls).not.toBeNull();
    expect(signals.tls?.reachable).toBe(true);
    expect(signals.tls?.protocol).toMatch(/^TLSv1\.\d$/);
  }, 30000);

  it("parses scripts, meta tags, and forms from real HTML", async () => {
    const signals = await collectSignals("https://books.toscrape.com");
    expect(Array.isArray(signals.scripts)).toBe(true);
    expect(Array.isArray(signals.metaTags)).toBe(true);
    expect(Array.isArray(signals.forms)).toBe(true);
    // books.toscrape.com has at least one search <form>.
    expect(signals.forms.length).toBeGreaterThan(0);
  }, 30000);

  it("records a well-known-path probe result for every configured path", async () => {
    const signals = await collectSignals("https://books.toscrape.com");
    expect(signals.wellKnownProbes.length).toBeGreaterThan(0);
    for (const probe of signals.wellKnownProbes) {
      expect(probe.path.startsWith("/")).toBe(true);
      expect(typeof probe.found).toBe("boolean");
    }
  }, 30000);

  it("reports robots.txt absence honestly rather than defaulting to found:true", async () => {
    // Verified directly: https://books.toscrape.com/robots.txt returns a real 404.
    const signals = await collectSignals("https://books.toscrape.com");
    expect(signals.robots?.found).toBe(false);
  }, 30000);
});
