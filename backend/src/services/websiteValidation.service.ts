import dns from "node:dns/promises";
import type { WebsiteValidationInput, WebsiteValidationResult } from "@kvl/shared";
import { probeTls } from "../utils/tlsProbe";
import { fetchProbe } from "../utils/httpProbe";
import { logEvent } from "../utils/logger";
import { AppError } from "../middleware/errorHandler";

/** Parses and validates the raw URL string, rejecting anything that isn't a well-formed http(s) URL. */
function parseWebsiteUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError(400, `"${raw}" is not a valid URL`, "Enter a full URL including the protocol, e.g. https://example.com", true);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError(400, `Unsupported URL protocol "${parsed.protocol}"`, "Website URL must start with http:// or https://", true);
  }
  return parsed;
}

/**
 * Step 3 — Website URL Validation. Every field is a live probe against the
 * customer's real website: DNS lookup, a direct TLS handshake, and HTTP
 * fetches for reachability, robots.txt, sitemap.xml and the homepage.
 */
export async function validateWebsite(input: WebsiteValidationInput): Promise<WebsiteValidationResult> {
  const websiteName = input.websiteName?.trim();
  if (!websiteName || websiteName.length < 2) {
    throw new AppError(400, "Website Name is required (minimum 2 characters)", "Enter the business or product name for this installation", true);
  }

  const parsed = parseWebsiteUrl(input.websiteUrl.trim());
  const hostname = parsed.hostname;
  const origin = parsed.origin;
  const errors: string[] = [];

  const [lookupResult, tlsResult, redirectCheck, reachableCheck, robotsCheck, sitemapCheck, homepageCheck] = await Promise.all([
    dns.lookup(hostname, { all: true }).catch((err: Error) => {
      errors.push(`DNS resolution failed: ${err.message}`);
      return [] as { address: string; family: number }[];
    }),
    probeTls(hostname, 443),
    fetchProbe(`http://${hostname}/`, { redirect: "manual" }),
    fetchProbe(input.websiteUrl.trim(), { redirect: "follow" }),
    fetchProbe(`${origin}/robots.txt`, { redirect: "follow" }),
    fetchProbe(`${origin}/sitemap.xml`, { redirect: "follow" }),
    fetchProbe(`${origin}/`, { redirect: "follow" }),
  ]);

  const dnsResolved = lookupResult.length > 0;

  const sslExpired = tlsResult.expiresAt ? new Date(tlsResult.expiresAt).getTime() < Date.now() : false;
  const sslValid = tlsResult.reachable && tlsResult.authorized && !sslExpired;
  if (tlsResult.reachable && !sslValid) {
    errors.push(sslExpired ? "SSL certificate has expired" : `SSL certificate is not trusted: ${tlsResult.error ?? "unknown reason"}`);
  }

  const httpsSupported = tlsResult.reachable;

  const httpRedirectsToHttps =
    redirectCheck.statusCode !== null &&
    redirectCheck.statusCode >= 300 &&
    redirectCheck.statusCode < 400 &&
    Boolean(redirectCheck.locationHeader?.startsWith("https://"));

  if (!reachableCheck.ok) {
    errors.push(`Website is not reachable at the provided URL: ${reachableCheck.error ?? `HTTP ${reachableCheck.statusCode}`}`);
  }
  if (!homepageCheck.ok) {
    errors.push(`Homepage did not respond successfully: ${homepageCheck.error ?? `HTTP ${homepageCheck.statusCode}`}`);
  }
  if (!dnsResolved) {
    // Already pushed a detailed DNS error above.
  }

  const overallValid = dnsResolved && httpsSupported && sslValid && reachableCheck.ok && homepageCheck.ok;

  const result: WebsiteValidationResult = {
    websiteName,
    websiteUrl: input.websiteUrl.trim(),
    dns: { resolved: dnsResolved, addresses: lookupResult.map((r) => r.address) },
    ssl: { valid: sslValid, issuer: tlsResult.issuer, expiresAt: tlsResult.expiresAt },
    https: { supported: httpsSupported },
    httpRedirectsToHttps,
    reachable: { ok: reachableCheck.ok, statusCode: reachableCheck.statusCode, latencyMs: reachableCheck.latencyMs },
    robotsTxt: { found: robotsCheck.ok, url: `${origin}/robots.txt` },
    sitemapXml: { found: sitemapCheck.ok, url: `${origin}/sitemap.xml` },
    homepageAvailable: homepageCheck.ok,
    overallValid,
    errors,
  };

  logEvent({
    component: "website-validation",
    message: `Validated ${result.websiteUrl} — overallValid=${overallValid}`,
    status: overallValid ? "success" : "warn",
  });

  return result;
}
