import type { SiteSignals, DetectionCandidate } from "../types";

/** Accumulates signal matches per candidate technology, then produces the DetectionCandidate[] every detect/*.ts module returns. Every detector uses this — the shared, DRY authoring pattern for "if this signal is present, it's evidence for that candidate". */
export class CandidateBuilder {
  private candidates = new Map<string, { signal: string; weight: number }[]>();

  add(name: string, signal: string, weight: number): void {
    const list = this.candidates.get(name);
    if (list) list.push({ signal, weight });
    else this.candidates.set(name, [{ signal, weight }]);
  }

  build(): DetectionCandidate[] {
    return [...this.candidates.entries()].map(([name, matches]) => ({ name, matches }));
  }
}

/** All HTML plus every script's src URL and inline body — the broadest haystack for a simple regex signature. */
export function htmlAndScriptsHaystack(signals: SiteSignals): string {
  const scriptText = signals.scripts.map((s) => s.src ?? s.inline ?? "").join(" ");
  const linkText = signals.linkTags.map((l) => l.href).join(" ");
  return `${signals.html} ${scriptText} ${linkText}`;
}

/** Just script src URLs (no inline bodies, no HTML) — useful when a signature should only match an actually-loaded external resource, not incidental text. */
export function scriptSrcHaystack(signals: SiteSignals): string {
  return signals.scripts.map((s) => s.src ?? "").join(" ");
}

/**
 * Script src URLs plus <link href> URLs — no raw HTML body, no inline
 * script bodies. For a "productname.js"/"productname.css" filename-style
 * signature, this is the haystack to search: `htmlAndScriptsHaystack`
 * includes the full visible page text, and a bare filename pattern
 * matches prose that merely *mentions* the technology by name just as
 * readily as an actual `<script src>`/`<link href>` reference — a real
 * false positive found testing against a real Wikipedia article whose
 * body text discusses "Vue.js" and "Angular" as encyclopedic content, with
 * no actual Vue/Angular script ever loaded on the page.
 */
export function assetUrlHaystack(signals: SiteSignals): string {
  const scriptSrcs = signals.scripts.map((s) => s.src ?? "").join(" ");
  const linkHrefs = signals.linkTags.map((l) => l.href).join(" ");
  return `${scriptSrcs} ${linkHrefs}`;
}

export function metaGeneratorContent(signals: SiteSignals): string {
  return signals.metaTags.find((m) => m.name?.toLowerCase() === "generator")?.content ?? "";
}

export function metaTagContent(signals: SiteSignals, name: string): string | null {
  const tag = signals.metaTags.find((m) => m.name?.toLowerCase() === name.toLowerCase() || m.property?.toLowerCase() === name.toLowerCase());
  return tag?.content ?? null;
}

export function cookieNamesHaystack(signals: SiteSignals): string {
  return signals.cookies.join(" ");
}

export function headerValue(signals: SiteSignals, headerName: string): string {
  const value = signals.headers[headerName.toLowerCase()];
  if (Array.isArray(value)) return value.join(" ");
  return value ?? "";
}

export function allHeadersHaystack(signals: SiteSignals): string {
  return Object.entries(signals.headers)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(",") : value ?? ""}`)
    .join("\n");
}

export function wellKnownPathFound(signals: SiteSignals, path: string): boolean {
  return signals.wellKnownProbes.some((p) => p.path === path && p.found);
}
