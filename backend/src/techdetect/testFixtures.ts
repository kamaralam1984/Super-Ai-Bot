import type { SiteSignals } from "./types";

/** Builds a minimal, fully-populated SiteSignals fixture for detector unit tests, with sensible empty defaults for every field so a test only needs to specify what it actually cares about. Not a *.test.ts file itself — a shared helper imported by them. */
export function buildSignals(overrides: Partial<SiteSignals> = {}): SiteSignals {
  return {
    requestedUrl: "https://example.test",
    finalUrl: "https://example.test",
    statusCode: 200,
    headers: {},
    html: "<html><head></head><body></body></html>",
    cookies: [],
    scripts: [],
    metaTags: [],
    linkTags: [],
    forms: [],
    structuredData: { jsonLd: [], openGraph: {}, twitterCard: {} },
    bodyClassNames: [],
    htmlAttributes: {},
    robots: null,
    sitemapUrls: [],
    wellKnownProbes: [],
    tls: null,
    dns: { nameservers: [] },
    ...overrides,
  };
}
