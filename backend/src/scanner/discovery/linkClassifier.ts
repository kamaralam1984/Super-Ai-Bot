export type LinkCategory = "internal" | "external" | "social" | "cdn" | "ad" | "tracking" | "asset";

const SOCIAL_DOMAINS = [
  "facebook.com", "fb.com", "twitter.com", "x.com", "instagram.com", "linkedin.com",
  "youtube.com", "youtu.be", "tiktok.com", "pinterest.com", "snapchat.com", "reddit.com",
  "telegram.org", "t.me", "wa.me", "whatsapp.com", "threads.net", "discord.com", "discord.gg",
];

const CDN_DOMAINS = [
  "cloudflare.com", "cdnjs.cloudflare.com", "jsdelivr.net", "unpkg.com", "googleapis.com",
  "gstatic.com", "akamaihd.net", "akamai.net", "fastly.net", "bootstrapcdn.com",
  "cloudfront.net", "jquery.com",
];

const AD_TRACKING_DOMAINS = [
  "googlesyndication.com", "doubleclick.net", "google-analytics.com", "googletagmanager.com",
  "googleadservices.com", "adservice.google.com", "facebook.net", "connect.facebook.net",
  "hotjar.com", "clarity.ms", "mixpanel.com", "segment.io", "segment.com", "amplitude.com",
  "criteo.com", "taboola.com", "outbrain.com", "adroll.com", "bing.com/bat.js",
];

const ASSET_EXTENSIONS = new Set([
  ".css", ".js", ".mjs", ".map", ".woff", ".woff2", ".ttf", ".eot", ".ico",
]);

function registrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split(".");
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

function matchesDomainList(hostname: string, list: string[]): boolean {
  const host = hostname.toLowerCase();
  return list.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Classifies a link relative to the site being scanned. Only "internal"
 * links are queued for crawling — everything else is discovered and noted
 * (for the crawl report) but never fetched as a page.
 */
export function classifyLink(url: string, baseUrl: string): LinkCategory {
  let parsed: URL;
  let base: URL;
  try {
    base = new URL(baseUrl);
    parsed = new URL(url, base);
  } catch {
    return "external";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "external";

  if (matchesDomainList(parsed.hostname, AD_TRACKING_DOMAINS)) return "tracking";
  if (matchesDomainList(parsed.hostname, SOCIAL_DOMAINS)) return "social";
  if (matchesDomainList(parsed.hostname, CDN_DOMAINS)) return "cdn";

  const pathLower = parsed.pathname.toLowerCase();
  if (ASSET_EXTENSIONS.has(pathLower.slice(pathLower.lastIndexOf(".")))) return "asset";

  const sameSite = registrableDomain(parsed.hostname) === registrableDomain(base.hostname);
  return sameSite ? "internal" : "external";
}

/** Strips fragments and normalizes trailing slashes so the same logical page isn't queued twice. */
export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}
