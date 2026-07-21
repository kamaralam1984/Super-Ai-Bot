import type { SiteSignals, DetectionCandidate } from "../types";
import { CandidateBuilder, htmlAndScriptsHaystack, assetUrlHaystack } from "./signalUtils";

/**
 * JavaScript libraries — jQuery, animation/3D/charting libraries, and
 * React component libraries (MUI/Ant Design/Chakra UI ship both JS and
 * CSS-in-JS, so they're categorized as libraries rather than
 * general-purpose CSS frameworks). Bare "productname.js" filename checks
 * search `assetUrls` (actual script src/link href values only) rather
 * than the full page text — see `assetUrlHaystack`'s docstring for the
 * real false positive that requires this distinction.
 */
export function detectJsLibraries(signals: SiteSignals): DetectionCandidate[] {
  const html = htmlAndScriptsHaystack(signals);
  const assetUrls = assetUrlHaystack(signals);
  const builder = new CandidateBuilder();

  if (/\bjquery(-\d+\.\d+\.\d+)?(\.min)?\.js\b/i.test(assetUrls)) builder.add("jQuery", "jquery.js script referenced", 0.85);
  if (/\bjQuery\s*\(/.test(html) || /\$\.fn\.jquery/i.test(html)) builder.add("jQuery", "jQuery(...) usage or $.fn.jquery referenced in inline script", 0.5);

  if (/class="[^"]*\bMui[A-Z][a-zA-Z]*-root\b/.test(html)) builder.add("Material UI", 'MuiXxx-root class name (Material UI\'s generated class prefix) found', 0.9);
  if (/@mui\/material|material-ui\/core/i.test(html)) builder.add("Material UI", "@mui/material bundle reference found", 0.8);

  if (/class="[^"]*\bant-[a-z]+(-[a-z]+)*\b/.test(html)) builder.add("Ant Design", 'ant-* class name (Ant Design\'s generated class prefix) found', 0.85);

  if (/class="[^"]*\bchakra-[a-z]+(-[a-z]+)*\b/.test(html)) builder.add("Chakra UI", 'chakra-* class name found', 0.85);

  if (/framer-motion/i.test(assetUrls)) builder.add("Framer Motion", '"framer-motion" referenced in a bundled script/link URL', 0.6);
  if (/data-framer-[a-z-]+=/i.test(html)) builder.add("Framer Motion", "data-framer-* attribute found", 0.5);

  if (/\bgsap(\.min)?\.js\b/i.test(assetUrls)) builder.add("GSAP", "gsap.js script referenced", 0.85);
  if (/\bTweenMax\b|\bTweenLite\b|\bScrollTrigger\b/.test(html)) builder.add("GSAP", "GSAP plugin (TweenMax/TweenLite/ScrollTrigger) referenced", 0.7);

  if (/swiper-(container|wrapper|slide)\b/i.test(html)) builder.add("Swiper", "swiper-container/wrapper/slide class name found", 0.85);
  if (/swiper-bundle(\.min)?\.(js|css)\b/i.test(assetUrls)) builder.add("Swiper", "swiper-bundle asset referenced", 0.85);

  if (/\bthree(\.module|\.min)?\.js\b/i.test(assetUrls)) builder.add("Three.js", "three.js script referenced", 0.85);
  if (/\bnew\s+THREE\.\w+/.test(html)) builder.add("Three.js", "THREE.* usage referenced in inline script", 0.6);

  if (/\bchart(\.umd|\.min)?\.js\b/i.test(assetUrls)) builder.add("Chart.js", "chart.js script referenced", 0.8);
  if (/new\s+Chart\s*\(/.test(html)) builder.add("Chart.js", "new Chart(...) usage referenced in inline script", 0.5);

  if (/recharts-(wrapper|surface)\b/i.test(html)) builder.add("Recharts", "recharts-wrapper/surface class name found", 0.85);
  if (/\brecharts\b/i.test(html) && /class="[^"]*recharts/i.test(html)) builder.add("Recharts", '"recharts" referenced alongside recharts-prefixed markup', 0.6);

  return builder.build();
}

/** General-purpose CSS frameworks — Bootstrap and Tailwind CSS. */
export function detectCssFrameworks(signals: SiteSignals): DetectionCandidate[] {
  const html = htmlAndScriptsHaystack(signals);
  const assetUrls = assetUrlHaystack(signals);
  const builder = new CandidateBuilder();

  if (/\bbootstrap(\.min)?\.css\b/i.test(assetUrls)) builder.add("Bootstrap", "bootstrap.css referenced", 0.85);
  if (/\bbootstrap(\.bundle)?(\.min)?\.js\b/i.test(assetUrls)) builder.add("Bootstrap", "bootstrap.js referenced", 0.8);
  if (/class="[^"]*\b(container-fluid|navbar-expand-[a-z]+|btn-(primary|secondary|outline)|col-(xs|sm|md|lg|xl)-\d+)\b/.test(html)) {
    builder.add("Bootstrap", "Bootstrap-conventional utility/grid class name found", 0.6);
  }

  if (/tailwindcss/i.test(assetUrls)) builder.add("Tailwind CSS", '"tailwindcss" referenced in an asset filename', 0.7);
  // Extract each class="..." attribute's *value* first, then count
  // Tailwind-style prefixed tokens within those values — matching the
  // greedy `class="[^"]*prefix:..."` pattern directly against the whole
  // HTML string undercounts: `[^"]*` is greedy, so it spans from the
  // first `class="` all the way to the *last* matching token in that one
  // attribute, collapsing what should be several distinct token matches
  // into one (caught by a synthetic test with 4 prefixed tokens in a
  // single class attribute matching only once).
  const classAttributeValues = [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]);
  const tailwindTokenPattern = /\b(?:sm|md|lg|xl|2xl|hover|focus|dark):[a-z-]+[a-z0-9-]*\b/g;
  const tailwindTokenCount = classAttributeValues.reduce((count, value) => count + (value.match(tailwindTokenPattern)?.length ?? 0), 0);
  if (tailwindTokenCount >= 2) {
    builder.add("Tailwind CSS", `${tailwindTokenCount} Tailwind-style responsive/state utility classes (sm:/hover:/dark:...) found`, 0.75);
  }

  return builder.build();
}
