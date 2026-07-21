import type { StructuredDataResult } from "../scanner/parse/structuredData";
import type { RobotsInfo } from "../scanner/discovery/robotsTxt";
import type { TlsProbeResult } from "../utils/tlsProbe";

/**
 * One piece of raw evidence for a single detection candidate. `weight` is
 * this signal's own standalone strength in [0, 1] — how confident would
 * you be in this candidate if this were the *only* thing you saw — not a
 * final score. The confidence engine (confidence/confidenceEngine.ts)
 * combines every matched signal's weight into one calibrated confidence
 * per candidate; individual detectors never compute confidence themselves.
 */
export interface SignalMatch {
  /** human-readable description of what matched, e.g. "wp-content path found in HTML" */
  signal: string;
  weight: number;
}

/** One candidate technology within a detection category (e.g. "WordPress" within CMS), with every signal that fired for it. */
export interface DetectionCandidate {
  name: string;
  matches: SignalMatch[];
}

/** A DetectionCandidate after the confidence engine has combined its signal weights into one calibrated score. */
export interface ScoredCandidate {
  name: string;
  confidence: number;
  evidence: string[];
}

export interface WellKnownProbe {
  path: string;
  found: boolean;
  statusCode: number | null;
}

export interface ParsedScriptTag {
  src: string | null;
  inline: string | null;
}

export interface ParsedMetaTag {
  name: string | null;
  property: string | null;
  content: string;
}

export interface ParsedLinkTag {
  rel: string | null;
  href: string;
  as: string | null;
}

export interface ParsedFormTag {
  action: string | null;
  method: string;
  id: string | null;
  className: string | null;
  fields: { name: string | null; type: string; placeholder: string | null }[];
}

/**
 * The single evidence bundle every detector in `detect/` reads from —
 * gathered once per site by `signals/signalCollector.ts`. Detectors never
 * make their own HTTP calls; this keeps every detection category
 * independently unit-testable against a plain object literal and keeps
 * the site visited exactly once per signal type (one homepage fetch, one
 * robots.txt fetch, one TLS probe, ...) no matter how many of the 16
 * categories run against it.
 */
export interface SiteSignals {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  html: string;
  /** raw Set-Cookie header values (not parsed into a jar — just for substring/regex signature matching) */
  cookies: string[];
  scripts: ParsedScriptTag[];
  metaTags: ParsedMetaTag[];
  linkTags: ParsedLinkTag[];
  forms: ParsedFormTag[];
  structuredData: StructuredDataResult;
  bodyClassNames: string[];
  htmlAttributes: Record<string, string>;
  robots: RobotsInfo | null;
  sitemapUrls: string[];
  wellKnownProbes: WellKnownProbe[];
  /** null when the site isn't served over https:// at all (no TLS endpoint to probe) */
  tls: TlsProbeResult | null;
  dns: {
    nameservers: string[];
  };
}
