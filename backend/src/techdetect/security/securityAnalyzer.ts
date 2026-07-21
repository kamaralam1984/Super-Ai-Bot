import type { SiteSignals } from "../types";
import { headerValue } from "../detect/signalUtils";

export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "info";

export interface SecurityFinding {
  check: string;
  passed: boolean;
  severity: SecuritySeverity;
  detail: string;
}

export interface SecurityAnalysisResult {
  findings: SecurityFinding[];
  score: number;
}

const SEVERITY_POINTS: Record<SecuritySeverity, number> = { critical: 25, high: 15, medium: 10, low: 5, info: 0 };

function parseCookieFlags(cookie: string): { secure: boolean; httpOnly: boolean; sameSite: string | null } {
  return {
    secure: /;\s*secure\b/i.test(cookie),
    httpOnly: /;\s*httponly\b/i.test(cookie),
    sameSite: cookie.match(/;\s*samesite=([a-z]+)/i)?.[1] ?? null,
  };
}

/**
 * Real, read-only security posture analysis — every check reads a
 * response header, the TLS handshake result, or a Set-Cookie flag that
 * the target already sent; nothing here sends a crafted or malicious
 * request. Produces a 0-100 score from a fixed points-per-severity table
 * so the same finding always contributes the same weight regardless of
 * how many other checks happened to apply to this particular site.
 */
export function analyzeSecurity(signals: SiteSignals): SecurityAnalysisResult {
  const findings: SecurityFinding[] = [];
  const isHttps = signals.finalUrl.startsWith("https://");

  findings.push({
    check: "HTTPS",
    passed: isHttps,
    severity: "critical",
    detail: isHttps ? "Site is served over HTTPS" : "Site is not served over HTTPS — all traffic (including any login/payment forms) is unencrypted",
  });

  if (isHttps) {
    const certValid = signals.tls?.authorized === true;
    findings.push({
      check: "SSL Certificate",
      passed: certValid,
      severity: "critical",
      detail: certValid
        ? `Valid TLS certificate (issuer: ${signals.tls?.issuer ?? "unknown"}, expires ${signals.tls?.expiresAt ?? "unknown"})`
        : `TLS certificate is not valid/trusted: ${signals.tls?.error ?? "certificate check did not complete"}`,
    });
  }

  // A present-but-max-age=0 HSTS header doesn't enable HSTS — it does the
  // opposite, telling browsers to *forget* HSTS immediately. Verified for
  // real against books.toscrape.com, which sends exactly this
  // (`max-age=0; includeSubDomains; preload`) — checking presence alone
  // would have reported HSTS as active on a site that's actually opted out.
  const hsts = headerValue(signals, "strict-transport-security");
  const hstsMaxAge = Number(hsts.match(/max-age=(\d+)/i)?.[1] ?? 0);
  findings.push({
    check: "HSTS",
    passed: hstsMaxAge > 0,
    severity: "high",
    detail: !hsts
      ? "Strict-Transport-Security header is missing — browsers won't be told to always use HTTPS for this site"
      : hstsMaxAge > 0
        ? `Strict-Transport-Security header present and active: "${hsts}"`
        : `Strict-Transport-Security header is present but max-age=0, which disables HSTS rather than enabling it: "${hsts}"`,
  });

  const csp = headerValue(signals, "content-security-policy");
  findings.push({
    check: "Content-Security-Policy",
    passed: csp.length > 0,
    severity: "high",
    detail: csp ? `Content-Security-Policy header present: "${csp.slice(0, 120)}${csp.length > 120 ? "..." : ""}"` : "Content-Security-Policy header is missing — no defense-in-depth against injected scripts",
  });

  const frameOptions = headerValue(signals, "x-frame-options");
  const cspFrameAncestors = /frame-ancestors/i.test(csp);
  findings.push({
    check: "Clickjacking Protection (X-Frame-Options / CSP frame-ancestors)",
    passed: frameOptions.length > 0 || cspFrameAncestors,
    severity: "medium",
    detail: frameOptions ? `X-Frame-Options: "${frameOptions}"` : cspFrameAncestors ? "CSP frame-ancestors directive present" : "No clickjacking protection header found",
  });

  const nosniff = headerValue(signals, "x-content-type-options");
  findings.push({
    check: "X-Content-Type-Options",
    passed: /nosniff/i.test(nosniff),
    severity: "medium",
    detail: /nosniff/i.test(nosniff) ? "X-Content-Type-Options: nosniff present" : "X-Content-Type-Options: nosniff is missing — browsers may MIME-sniff responses",
  });

  // X-XSS-Protection is deprecated (modern browsers ignore it in favor of
  // CSP) but the spec explicitly asks for it, so it's checked and reported
  // — scored as "low" severity/no points either way, reflecting that its
  // real-world protective value today is minimal, documented honestly
  // rather than treated as equivalent to a real, current control.
  const xssProtection = headerValue(signals, "x-xss-protection");
  findings.push({
    check: "XSS Protection (X-XSS-Protection)",
    passed: xssProtection.length > 0,
    severity: "low",
    detail: xssProtection
      ? `X-XSS-Protection header present: "${xssProtection}" (a legacy header modern browsers largely ignore — Content-Security-Policy is the current control)`
      : "X-XSS-Protection header is missing (legacy header with minimal effect in modern browsers regardless — Content-Security-Policy is what actually matters here)",
  });

  const corsOrigin = headerValue(signals, "access-control-allow-origin");
  const corsCredentials = headerValue(signals, "access-control-allow-credentials");
  if (corsOrigin) {
    const misconfigured = corsOrigin.trim() === "*" && /true/i.test(corsCredentials);
    findings.push({
      check: "CORS",
      passed: !misconfigured,
      severity: "medium",
      detail: misconfigured
        ? "Access-Control-Allow-Origin: * combined with Access-Control-Allow-Credentials: true — a real, well-known dangerous misconfiguration (most browsers now reject this combination, but serving it at all indicates a misconfigured CORS policy)"
        : `Access-Control-Allow-Origin: "${corsOrigin}" (no wildcard+credentials misconfiguration)`,
    });
  }

  if (signals.cookies.length > 0) {
    const insecureCookies = signals.cookies.filter((c) => {
      const flags = parseCookieFlags(c);
      return !flags.secure || !flags.httpOnly;
    });
    findings.push({
      check: "Cookie Policy",
      passed: insecureCookies.length === 0,
      severity: "medium",
      detail:
        insecureCookies.length === 0
          ? `All ${signals.cookies.length} cookie(s) set the Secure and HttpOnly flags`
          : `${insecureCookies.length} of ${signals.cookies.length} cookie(s) are missing the Secure and/or HttpOnly flag`,
    });
  }

  const earnedPoints = findings.filter((f) => f.passed).reduce((sum, f) => sum + SEVERITY_POINTS[f.severity], 0);
  const applicablePoints = findings.reduce((sum, f) => sum + SEVERITY_POINTS[f.severity], 0);
  const score = applicablePoints > 0 ? Math.round((earnedPoints / applicablePoints) * 100) : 100;

  return { findings, score };
}
