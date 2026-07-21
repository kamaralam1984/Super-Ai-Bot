import type { SiteSignals } from "../types";
import { headerValue } from "../detect/signalUtils";

export type PerformanceSeverity = "high" | "medium" | "low" | "info";

export interface PerformanceFinding {
  check: string;
  passed: boolean;
  severity: PerformanceSeverity;
  detail: string;
}

export interface PerformanceAnalysisResult {
  findings: PerformanceFinding[];
  score: number;
}

const SEVERITY_POINTS: Record<PerformanceSeverity, number> = { high: 20, medium: 12, low: 6, info: 0 };

/**
 * Real, read-only performance posture analysis from a single homepage
 * fetch — no synthetic browser performance trace, no Lighthouse run.
 * "Core Web Vitals Indicators" here means exactly that: static HTML
 * proxy signals correlated with good LCP/CLS/INP (explicit image
 * dimensions, preload/preconnect hints, font-display strategy), not a
 * measured Core Web Vitals score — this project doesn't claim to measure
 * what it hasn't actually measured. Every other check reads a response
 * header or counts an HTML attribute that's already present in what the
 * site sent.
 */
export function analyzePerformance(signals: SiteSignals): PerformanceAnalysisResult {
  const findings: PerformanceFinding[] = [];
  const html = signals.html;

  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  if (imgTags.length > 0) {
    const lazyCount = imgTags.filter((tag) => /loading=["']lazy["']/i.test(tag)).length;
    findings.push({
      check: "Lazy Loading",
      passed: lazyCount > 0,
      severity: "medium",
      detail: `${lazyCount} of ${imgTags.length} <img> tag(s) use loading="lazy"`,
    });

    const dimensionedCount = imgTags.filter((tag) => /\bwidth=["']?\d/i.test(tag) && /\bheight=["']?\d/i.test(tag)).length;
    findings.push({
      check: "Core Web Vitals Indicator: Image Dimensions",
      passed: dimensionedCount === imgTags.length,
      severity: "medium",
      detail: `${dimensionedCount} of ${imgTags.length} <img> tag(s) specify explicit width/height (prevents layout shift while loading)`,
    });

    const modernFormatOrResponsive = /\.(webp|avif)(\?|["'])/i.test(html) || /<picture[\s>]/i.test(html) || imgTags.some((tag) => /\bsrcset=/i.test(tag));
    findings.push({
      check: "Image Optimization",
      passed: modernFormatOrResponsive,
      severity: "medium",
      detail: modernFormatOrResponsive
        ? "Modern image formats (WebP/AVIF), <picture>, or responsive srcset usage found"
        : "No WebP/AVIF, <picture>, or srcset usage found — images are likely served as unoptimized, single-resolution files",
    });
  }

  const contentEncoding = headerValue(signals, "content-encoding");
  findings.push({
    check: "Compression",
    passed: /gzip|br|deflate|zstd/i.test(contentEncoding),
    severity: "high",
    detail: contentEncoding ? `Content-Encoding: "${contentEncoding}"` : "No Content-Encoding header — the response was likely sent uncompressed",
  });

  const cacheControl = headerValue(signals, "cache-control");
  const etag = headerValue(signals, "etag");
  const expires = headerValue(signals, "expires");
  const hasCaching = cacheControl.length > 0 || etag.length > 0 || expires.length > 0;
  findings.push({
    check: "Caching",
    passed: hasCaching,
    severity: "high",
    detail: hasCaching ? `Caching header(s) present: ${[cacheControl && `Cache-Control="${cacheControl}"`, etag && "ETag", expires && "Expires"].filter(Boolean).join(", ")}` : "No Cache-Control, ETag, or Expires header present",
  });

  const hasPreconnectOrPreload = /<link[^>]+rel=["'](preconnect|dns-prefetch|preload)["']/i.test(html);
  findings.push({
    check: "Core Web Vitals Indicator: Resource Hints",
    passed: hasPreconnectOrPreload,
    severity: "low",
    detail: hasPreconnectOrPreload ? "preconnect/dns-prefetch/preload resource hints found" : "No preconnect/dns-prefetch/preload resource hints found",
  });

  const fontDisplaySwap = /font-display:\s*swap/i.test(html);
  const usesWebFonts = /@font-face|fonts\.googleapis\.com/i.test(html);
  if (usesWebFonts) {
    findings.push({
      check: "Core Web Vitals Indicator: Font Loading Strategy",
      passed: fontDisplaySwap,
      severity: "low",
      detail: fontDisplaySwap ? "font-display: swap found — avoids invisible text while web fonts load" : "Web fonts are used but no font-display: swap was found — may cause invisible text while loading",
    });
  }

  const scriptSrcs = signals.scripts.map((s) => s.src).filter((s): s is string => s !== null);
  const linkHrefs = signals.linkTags.map((l) => l.href);
  const assetUrls = [...scriptSrcs, ...linkHrefs.filter((h) => /\.css(\?|$)/i.test(h))];
  if (assetUrls.length > 0) {
    const minifiedCount = assetUrls.filter((url) => /\.min\.(js|css)(\?|$)/i.test(url)).length;
    findings.push({
      check: "Asset Minification",
      passed: minifiedCount / assetUrls.length >= 0.5,
      severity: "medium",
      detail: `${minifiedCount} of ${assetUrls.length} script/stylesheet asset(s) use a .min. filename convention`,
    });
  }

  const earnedPoints = findings.filter((f) => f.passed).reduce((sum, f) => sum + SEVERITY_POINTS[f.severity], 0);
  const applicablePoints = findings.reduce((sum, f) => sum + SEVERITY_POINTS[f.severity], 0);
  const score = applicablePoints > 0 ? Math.round((earnedPoints / applicablePoints) * 100) : 100;

  return { findings, score };
}
