import type { SiteSignals, DetectionCandidate } from "../types";
import { CandidateBuilder, htmlAndScriptsHaystack, headerValue, allHeadersHaystack } from "./signalUtils";

function nameserversHaystack(signals: SiteSignals): string {
  return signals.dns.nameservers.join(" ");
}

/** Server software (Apache/Nginx/LiteSpeed/IIS/Caddy/...) from the Server response header — the single most reliable signal in this whole category, since it's set directly by the software itself. */
export function detectServer(signals: SiteSignals): DetectionCandidate[] {
  const server = headerValue(signals, "server");
  const builder = new CandidateBuilder();

  if (!server) {
    return [{ name: "Custom Server", matches: [{ signal: "No Server response header present", weight: 0.3 }] }];
  }

  if (/openlitespeed/i.test(server)) builder.add("OpenLiteSpeed", `Server header: "${server}"`, 0.95);
  else if (/litespeed/i.test(server)) builder.add("LiteSpeed", `Server header: "${server}"`, 0.95);
  if (/^apache/i.test(server)) builder.add("Apache", `Server header: "${server}"`, 0.95);
  if (/^nginx/i.test(server)) builder.add("Nginx", `Server header: "${server}"`, 0.95);
  if (/microsoft-iis/i.test(server)) builder.add("IIS", `Server header: "${server}"`, 0.95);
  if (/^caddy/i.test(server)) builder.add("Caddy", `Server header: "${server}"`, 0.95);
  if (/^cowboy$/i.test(server.trim())) builder.add("Node Server", `Server header: "${server}" (Cowboy, Heroku's Erlang-based router — the origin behind it is commonly Node.js)`, 0.4);

  const candidates = builder.build();
  if (candidates.length > 0) return candidates;

  // Managed platforms (Vercel, Netlify, Cloudflare, CloudFront, ...) put
  // their own product name in the Server header — that's real, identified
  // information (see detect/hostingDetector.ts's detectHosting/detectCdn,
  // which pick these up), just not "web server software" in the
  // Apache/Nginx/IIS sense this category is about. Worded to reflect that
  // rather than implying the value is unknown.
  const KNOWN_PLATFORM_SERVER_VALUES = /^(vercel|netlify|cloudflare|cloudfront|github\.com)$/i;
  if (KNOWN_PLATFORM_SERVER_VALUES.test(server.trim())) {
    return [{ name: "Custom Server", matches: [{ signal: `Server header identifies a managed platform ("${server}"), not traditional web server software — see hosting/CDN results`, weight: 0.2 }] }];
  }

  return [{ name: "Custom Server", matches: [{ signal: `Server header value doesn't match a known web server signature: "${server}"`, weight: 0.35 }] }];
}

/** CDN detection — response headers set by the edge network itself, plus asset domains that only that CDN serves from. */
export function detectCdn(signals: SiteSignals): DetectionCandidate[] {
  const headers = allHeadersHaystack(signals);
  const server = headerValue(signals, "server");
  const html = htmlAndScriptsHaystack(signals);
  const builder = new CandidateBuilder();

  if (/^cloudflare$/i.test(server.trim())) builder.add("Cloudflare", `Server header: "${server}"`, 0.9);
  if (/\bcf-ray\b/i.test(headers)) builder.add("Cloudflare", "CF-Ray header present", 0.9);
  if (/\bcf-cache-status\b/i.test(headers)) builder.add("Cloudflare", "CF-Cache-Status header present", 0.85);

  if (/^cloudfront$/i.test(server.trim())) builder.add("CloudFront", `Server header: "${server}"`, 0.9);
  if (/\bx-amz-cf-id\b/i.test(headers)) builder.add("CloudFront", "X-Amz-Cf-Id header present", 0.9);
  if (/from cloudfront/i.test(headers)) builder.add("CloudFront", "X-Cache header mentions CloudFront", 0.9);

  if (/\bx-fastly-request-id\b/i.test(headers)) builder.add("Fastly", "X-Fastly-Request-Id header present", 0.9);
  if (/x-served-by:[^\n]*cache-/i.test(headers)) builder.add("Fastly", "X-Served-By header matches Fastly's cache-node naming convention", 0.6);

  if (/^bunnycdn$/i.test(server.trim())) builder.add("BunnyCDN", `Server header: "${server}"`, 0.9);
  if (/\.b-cdn\.net/i.test(html)) builder.add("BunnyCDN", "b-cdn.net asset domain referenced", 0.8);

  if (/\bx-akamai-/i.test(headers) || /akamai/i.test(server)) builder.add("Akamai", "Akamai-specific header/Server value present", 0.85);

  if (/\.kxcdn\.com/i.test(html)) builder.add("KeyCDN", "kxcdn.com asset domain referenced", 0.85);

  if (/cdn\.jsdelivr\.net/i.test(html)) builder.add("JSDelivr", "cdn.jsdelivr.net asset URL referenced", 0.85);
  if (/unpkg\.com/i.test(html)) builder.add("UNPKG", "unpkg.com asset URL referenced", 0.85);

  return builder.build();
}

const NAMESERVER_HOSTING_SIGNATURES: [RegExp, string, number][] = [
  [/awsdns-/i, "AWS", 0.8],
  [/azure-dns\.(com|net|org|info)/i, "Azure", 0.85],
  [/googledomains\.com|google\.com$/i, "Google Cloud", 0.6],
  [/ns\d*\.digitalocean\.com/i, "DigitalOcean", 0.85],
  [/hostinger\.(com|in)|dns-parking\.com/i, "Hostinger", 0.8],
  [/bluehost\.com/i, "Bluehost", 0.85],
  [/siteground\.(com|net)/i, "SiteGround", 0.85],
  [/netlifydns\.com/i, "Netlify", 0.85],
  // NS1 (nsone.net) is a general-purpose managed DNS provider used by many
  // unrelated organizations, not exclusively Netlify — a generic
  // "dnsN.pNN.nsone.net" pattern alone previously implied Netlify and
  // produced a real false positive against github.com (which uses NS1
  // alongside AWS nameservers and has nothing to do with Netlify).
  // Netlify's own *branded* nameservers (netlifydns.com, above) remain a
  // reliable signal; the bare NS1 pattern was removed rather than kept at
  // a lower weight, since it isn't evidence for Netlify *specifically* at
  // any weight.
  [/vercel-dns\.com/i, "Vercel", 0.85],
  [/cloudflare\.com$/i, "Cloudflare", 0.6],
];

/**
 * Hosting-provider inference — the hardest of the three categories here,
 * since "who hosts this" usually isn't advertised the way a CDN or web
 * server literally is. Combines DNS nameserver ownership (a real,
 * reliable signal for the *DNS* provider, which is very often the same as
 * the hosting provider for managed platforms) with a handful of
 * platform-specific response headers documented by each platform itself.
 * Falls back to an honestly-labeled "Custom VPS or Dedicated Server"
 * candidate rather than guessing among indistinguishable options — this
 * project never fabricates confidence it doesn't have.
 */
export function detectHosting(signals: SiteSignals): DetectionCandidate[] {
  const headers = allHeadersHaystack(signals);
  const nameservers = nameserversHaystack(signals);
  const builder = new CandidateBuilder();

  if (/\bx-vercel-id\b/i.test(headers)) builder.add("Vercel", "X-Vercel-Id header present", 0.9);
  if (/\bx-nf-request-id\b/i.test(headers)) builder.add("Netlify", "X-Nf-Request-Id header present", 0.9);
  if (/\bx-railway-/i.test(headers)) builder.add("Railway", "X-Railway-* header present", 0.9);
  if (/\bvia:[^\n]*vegur\b/i.test(headers)) builder.add("Heroku", "Via header mentions Vegur (Heroku's routing layer)", 0.85);
  if (/^cowboy$/im.test(headers)) builder.add("Heroku", "Server header is Cowboy (commonly fronts Heroku dynos)", 0.35);
  if (/\bx-render-origin-server\b/i.test(headers)) builder.add("Render", "X-Render-Origin-Server header present", 0.85);
  if (/server:\s*gws|x-goog-/i.test(headers)) builder.add("Google Cloud", "Google Frontend (gws) Server header or X-Goog-* header present", 0.6);
  if (/\bx-azure-ref\b/i.test(headers)) builder.add("Azure", "X-Azure-Ref header present", 0.85);
  if (/\bx-amz-cf-id\b|\bx-amzn-/i.test(headers)) builder.add("AWS", "X-Amz(n)-* header present", 0.6);

  for (const [pattern, name, weight] of NAMESERVER_HOSTING_SIGNATURES) {
    if (pattern.test(nameservers)) builder.add(name, `Nameserver matches ${name}'s DNS naming convention (${nameservers.match(pattern)?.[0]})`, weight);
  }

  const candidates = builder.build();
  if (candidates.length === 0) {
    return [
      {
        name: "Custom VPS or Dedicated Server",
        matches: [{ signal: "No managed hosting platform, CDN-as-host, or recognized DNS provider signature matched — genuinely indistinguishable from outside between a VPS, dedicated server, or shared hosting plan without more information", weight: 0.3 }],
      },
    ];
  }
  return candidates;
}
