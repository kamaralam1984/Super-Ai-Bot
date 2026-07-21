import type { SiteSignals, DetectionCandidate } from "../types";
import { CandidateBuilder, htmlAndScriptsHaystack, scriptSrcHaystack } from "./signalUtils";

/**
 * Detects the frontend framework/library a site is built with. Several
 * frameworks here are themselves built on React (Next.js, Gatsby, Remix)
 * — when both fire, that's correct, not a conflict: a Next.js site really
 * is also a React site, the same way a WooCommerce store is also
 * WordPress (see cmsDetector.ts).
 */
export function detectFrontend(signals: SiteSignals): DetectionCandidate[] {
  const html = htmlAndScriptsHaystack(signals);
  // A bare "productname.js" pattern searched against the *full* page text
  // (html) matches prose that merely mentions the technology by name, not
  // just an actual <script src> reference — a real false positive found
  // testing against a real Wikipedia article about web development, whose
  // body text literally contains the words "Vue.js" and "Angular" as
  // encyclopedic content. Checks below that are genuinely filename
  // patterns search only actual script src URLs; checks for markup/DOM
  // structure (data-v-*, ng-version, <app-root>, ...) are safe against
  // htmlAndScriptsHaystack since that structure can't occur in plain prose.
  const scriptSrcs = scriptSrcHaystack(signals);
  const attrs = signals.htmlAttributes;
  const builder = new CandidateBuilder();

  // Next.js
  if (/__NEXT_DATA__/i.test(html)) builder.add("Next.js", "__NEXT_DATA__ script found", 0.95);
  if (/\/_next\/static\//i.test(html)) builder.add("Next.js", "/_next/static/ asset path found", 0.9);
  if (/name="next-head-count"/i.test(html)) builder.add("Next.js", "next-head-count meta tag found", 0.85);

  // React (standalone signal — also fires under Next.js/Gatsby/Remix, correctly)
  if (/data-reactroot|data-reactid/i.test(html)) builder.add("React", "data-reactroot/data-reactid attribute found (legacy React <16 marker)", 0.85);
  if (/react-dom(\.production|\.development)?(\.min)?\.js/i.test(scriptSrcs)) builder.add("React", "react-dom script referenced", 0.8);
  // React 16+ dropped data-reactroot entirely, and modern bundlers hash
  // chunk filenames so "react-dom" rarely appears literally in a script
  // src — but React 18's server-streaming/Suspense hydration still emits
  // these literal HTML comment markers around every boundary, verified
  // present on a real, current React 18 site (reactjs.org) that has
  // neither of the two signals above.
  if (signals.html.includes("<!--$-->") && signals.html.includes("<!--/$-->")) {
    builder.add("React", "React 18 Suspense/streaming hydration markers (<!--$-->) found", 0.8);
  }

  // Vue
  if (/data-v-[a-f0-9]{6,10}/i.test(html)) builder.add("Vue", "Vue scoped-style data-v-* attribute found", 0.85);
  if (/\bvue(\.runtime)?(\.global)?(\.min)?\.js/i.test(scriptSrcs)) builder.add("Vue", "vue.js runtime script referenced", 0.75);
  if (/\bv-cloak\b|\bv-if=|\bv-for=|\bv-bind:/i.test(html)) builder.add("Vue", "Vue directive (v-if/v-for/v-bind/v-cloak) found", 0.6);

  // Nuxt
  if (/__NUXT__/i.test(html)) builder.add("Nuxt", "__NUXT__ global object referenced", 0.95);
  if (/\/_nuxt\//i.test(html)) builder.add("Nuxt", "/_nuxt/ asset path found", 0.9);
  if (/id="__nuxt"/i.test(html)) builder.add("Nuxt", '<div id="__nuxt"> mount point found', 0.85);

  // Angular
  if ("ng-version" in attrs || /\bng-version="/i.test(html)) builder.add("Angular", "ng-version attribute found", 0.95);
  if (/<app-root[\s>]/i.test(html)) builder.add("Angular", "<app-root> custom element found", 0.75);
  if (/_nghost-|_ngcontent-/i.test(html)) builder.add("Angular", "Angular view-encapsulation attribute (_nghost/_ngcontent) found", 0.85);
  if (/\bangular(\.min)?\.js\b/i.test(scriptSrcs)) builder.add("Angular", "angular.js script referenced", 0.6);

  // Svelte / SvelteKit
  if (/class="[^"]*\bsvelte-[a-z0-9]{5,8}\b/i.test(html)) builder.add("Svelte", "Svelte scoped-style class hash found", 0.85);
  if (/\/_app\/immutable\//i.test(html)) builder.add("Svelte", "SvelteKit /_app/immutable/ asset path found", 0.9);

  // Astro
  if (/<astro-island[\s>]/i.test(html)) builder.add("Astro", "<astro-island> custom element found", 0.95);
  if (/data-astro-cid-/i.test(html)) builder.add("Astro", "data-astro-cid-* attribute found", 0.85);
  if (/\/_astro\//i.test(html)) builder.add("Astro", "/_astro/ asset path found", 0.8);

  // Remix
  if (/__remixContext|__remixManifest/i.test(html)) builder.add("Remix", "__remixContext/__remixManifest global referenced", 0.95);

  // Gatsby
  if (/id="___gatsby"/i.test(html)) builder.add("Gatsby", '<div id="___gatsby"> mount point found', 0.9);
  if (/\/page-data\//i.test(html)) builder.add("Gatsby", "/page-data/ asset path found", 0.85);

  const candidates = builder.build();

  if (candidates.length === 0 && signals.html.trim().length > 0) {
    return [{ name: "HTML Static Website", matches: [{ signal: "No known frontend framework signature matched", weight: 0.4 }] }];
  }

  return candidates;
}
