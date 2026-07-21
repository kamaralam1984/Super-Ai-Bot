import { describe, it, expect } from "vitest";
import { detectServer, detectCdn, detectHosting } from "./hostingDetector";
import { buildSignals } from "../testFixtures";
import { collectSignals } from "../signals/signalCollector";

describe("detectServer — synthetic signatures", () => {
  it("detects Apache, Nginx, LiteSpeed, OpenLiteSpeed, IIS, Caddy from the Server header", () => {
    expect(detectServer(buildSignals({ headers: { server: "Apache/2.4.58 (Ubuntu)" } })).map((c) => c.name)).toContain("Apache");
    expect(detectServer(buildSignals({ headers: { server: "nginx/1.25.3" } })).map((c) => c.name)).toContain("Nginx");
    expect(detectServer(buildSignals({ headers: { server: "LiteSpeed" } })).map((c) => c.name)).toContain("LiteSpeed");
    expect(detectServer(buildSignals({ headers: { server: "OpenLiteSpeed" } })).map((c) => c.name)).toContain("OpenLiteSpeed");
    expect(detectServer(buildSignals({ headers: { server: "Microsoft-IIS/10.0" } })).map((c) => c.name)).toContain("IIS");
    expect(detectServer(buildSignals({ headers: { server: "Caddy" } })).map((c) => c.name)).toContain("Caddy");
  });

  it("falls back to Custom Server with no header at all", () => {
    const result = detectServer(buildSignals({ headers: {} }));
    expect(result).toEqual([{ name: "Custom Server", matches: [{ signal: "No Server response header present", weight: 0.3 }] }]);
  });

  it("labels a known managed-platform Server value distinctly from a genuinely unrecognized one", () => {
    const vercel = detectServer(buildSignals({ headers: { server: "Vercel" } }));
    expect(vercel[0].matches[0].signal).toContain("managed platform");

    const unknown = detectServer(buildSignals({ headers: { server: "MyWeirdCustomServer/1.0" } }));
    expect(unknown[0].matches[0].signal).toContain("doesn't match a known web server signature");
  });
});

describe("detectCdn — synthetic signatures", () => {
  it("detects Cloudflare from CF-Ray and CF-Cache-Status headers", () => {
    const signals = buildSignals({ headers: { "cf-ray": "abc123-SJC", "cf-cache-status": "HIT" } });
    expect(detectCdn(signals).map((c) => c.name)).toContain("Cloudflare");
  });

  it("detects CloudFront from X-Amz-Cf-Id", () => {
    const signals = buildSignals({ headers: { "x-amz-cf-id": "abc123" } });
    expect(detectCdn(signals).map((c) => c.name)).toContain("CloudFront");
  });

  it("detects Fastly from X-Fastly-Request-Id", () => {
    const signals = buildSignals({ headers: { "x-fastly-request-id": "abc123" } });
    expect(detectCdn(signals).map((c) => c.name)).toContain("Fastly");
  });

  it("detects BunnyCDN from the b-cdn.net asset domain", () => {
    const signals = buildSignals({ html: '<script src="https://mysite.b-cdn.net/app.js"></script>' });
    expect(detectCdn(signals).map((c) => c.name)).toContain("BunnyCDN");
  });

  it("detects JSDelivr and UNPKG from their asset domains", () => {
    const signals = buildSignals({ html: '<script src="https://cdn.jsdelivr.net/npm/lib@1/dist.js"></script><script src="https://unpkg.com/lib@1/dist.js"></script>' });
    const names = detectCdn(signals).map((c) => c.name);
    expect(names).toContain("JSDelivr");
    expect(names).toContain("UNPKG");
  });

  it("returns no candidates when no CDN signature is present", () => {
    expect(detectCdn(buildSignals())).toEqual([]);
  });
});

describe("detectHosting — synthetic signatures", () => {
  it("detects Vercel from X-Vercel-Id header and nameservers", () => {
    const signals = buildSignals({ headers: { "x-vercel-id": "abc" }, dns: { nameservers: ["ns1.vercel-dns.com"] } });
    expect(detectHosting(signals).map((c) => c.name)).toContain("Vercel");
  });

  it("detects Netlify from X-Nf-Request-Id header and netlifydns.com nameservers", () => {
    const signals = buildSignals({ headers: { "x-nf-request-id": "abc" }, dns: { nameservers: ["ns01.netlifydns.com"] } });
    expect(detectHosting(signals).map((c) => c.name)).toContain("Netlify");
  });

  it("detects Heroku from the Vegur Via header", () => {
    const signals = buildSignals({ headers: { via: "1.1 vegur" } });
    expect(detectHosting(signals).map((c) => c.name)).toContain("Heroku");
  });

  it("detects Railway from X-Railway-* headers", () => {
    const signals = buildSignals({ headers: { "x-railway-request-id": "abc" } });
    expect(detectHosting(signals).map((c) => c.name)).toContain("Railway");
  });

  it("infers AWS from awsdns- nameservers", () => {
    const signals = buildSignals({ dns: { nameservers: ["ns-123.awsdns-45.com"] } });
    expect(detectHosting(signals).map((c) => c.name)).toContain("AWS");
  });

  it("infers Azure from azure-dns nameservers and X-Azure-Ref header", () => {
    const signals = buildSignals({ dns: { nameservers: ["ns1-01.azure-dns.com"] }, headers: { "x-azure-ref": "abc" } });
    expect(detectHosting(signals).map((c) => c.name)).toContain("Azure");
  });

  it("infers Hostinger, Bluehost, SiteGround from their nameserver conventions", () => {
    expect(detectHosting(buildSignals({ dns: { nameservers: ["ns1.dns-parking.com"] } })).map((c) => c.name)).toContain("Hostinger");
    expect(detectHosting(buildSignals({ dns: { nameservers: ["ns1.bluehost.com"] } })).map((c) => c.name)).toContain("Bluehost");
    expect(detectHosting(buildSignals({ dns: { nameservers: ["ns1.siteground.net"] } })).map((c) => c.name)).toContain("SiteGround");
  });

  it("falls back to an honestly-labeled Custom VPS/Dedicated Server candidate when nothing matches", () => {
    const result = detectHosting(buildSignals());
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Custom VPS or Dedicated Server");
    expect(result[0].matches[0].weight).toBeLessThan(0.5);
  });
});

describe("hosting/server/CDN detectors — real websites", () => {
  it("detects AWS hosting via nameservers on a real site with no CDN in front", async () => {
    const signals = await collectSignals("https://books.toscrape.com");
    expect(detectHosting(signals).map((c) => c.name)).toContain("AWS");
    expect(detectCdn(signals)).toEqual([]);
  }, 30000);

  it("detects Cloudflare as both CDN and hosting on a real Cloudflare-fronted site", async () => {
    const signals = await collectSignals("https://example.com");
    expect(detectCdn(signals).map((c) => c.name)).toContain("Cloudflare");
    expect(detectHosting(signals).map((c) => c.name)).toContain("Cloudflare");
  }, 30000);

  it("detects Vercel hosting on a real live Vercel-hosted site", async () => {
    const signals = await collectSignals("https://vercel.com");
    expect(detectHosting(signals).map((c) => c.name)).toContain("Vercel");
  }, 30000);
});
