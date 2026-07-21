import { describe, it, expect } from "vitest";
import { detectRobotsTxtChange, detectSitemapChanges, detectTechnologyChanges } from "./siteMetadataMonitor";

describe("detectSitemapChanges", () => {
  it("reports no change for identical URL sets, regardless of order", () => {
    const result = detectSitemapChanges(["a", "b"], ["b", "a"]);
    expect(result.changed).toBe(false);
  });

  it("detects added URLs", () => {
    const result = detectSitemapChanges(["a"], ["a", "b", "c"]);
    expect(result).toMatchObject({ changed: true, urlsAdded: 2, urlsRemoved: 0 });
    expect(result.addedUrls).toEqual(["b", "c"]);
  });

  it("detects removed URLs", () => {
    const result = detectSitemapChanges(["a", "b"], []);
    expect(result).toMatchObject({ changed: true, urlsAdded: 0, urlsRemoved: 2 });
  });

  it("caps the listed URLs at 25 while still reporting the true count", () => {
    const oldUrls: string[] = [];
    const newUrls = Array.from({ length: 40 }, (_, i) => `https://example.com/${i}`);
    const result = detectSitemapChanges(oldUrls, newUrls);
    expect(result.urlsAdded).toBe(40);
    expect(result.addedUrls).toHaveLength(25);
  });
});

describe("detectRobotsTxtChange", () => {
  it("reports no change for identical content", () => {
    expect(detectRobotsTxtChange("User-agent: *\nDisallow: /admin", "User-agent: *\nDisallow: /admin").changed).toBe(false);
  });

  it("ignores line-ending and surrounding-whitespace differences", () => {
    expect(detectRobotsTxtChange("User-agent: *\r\nDisallow: /admin", "  User-agent: *\nDisallow: /admin  ").changed).toBe(false);
  });

  it("detects a real rule change", () => {
    expect(detectRobotsTxtChange("Disallow: /admin", "Disallow: /admin\nDisallow: /private").changed).toBe(true);
  });

  it("treats null (no robots.txt) to present content as a change", () => {
    expect(detectRobotsTxtChange(null, "Disallow: /").changed).toBe(true);
  });

  it("treats null to null as no change", () => {
    expect(detectRobotsTxtChange(null, null).changed).toBe(false);
  });
});

describe("detectTechnologyChanges", () => {
  it("reports no change for the same technology set", () => {
    expect(detectTechnologyChanges(["WordPress", "WooCommerce"], ["WooCommerce", "WordPress"]).changed).toBe(false);
  });

  it("detects a platform migration", () => {
    const result = detectTechnologyChanges(["WordPress"], ["Next.js"]);
    expect(result).toEqual({ changed: true, addedTechnologies: ["Next.js"], removedTechnologies: ["WordPress"] });
  });

  it("detects a newly added technology alongside unchanged ones", () => {
    const result = detectTechnologyChanges(["WordPress"], ["WordPress", "Cloudflare"]);
    expect(result).toEqual({ changed: true, addedTechnologies: ["Cloudflare"], removedTechnologies: [] });
  });
});
