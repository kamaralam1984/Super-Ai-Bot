import { describe, it, expect } from "vitest";
import { detectFrontend } from "./frontendDetector";
import { buildSignals } from "../testFixtures";
import { collectSignals } from "../signals/signalCollector";

function namesOf(result: ReturnType<typeof detectFrontend>): string[] {
  return result.map((c) => c.name);
}

describe("detectFrontend — synthetic signatures", () => {
  it("detects Next.js from __NEXT_DATA__ and /_next/static/", () => {
    const signals = buildSignals({ html: '<script id="__NEXT_DATA__" type="application/json">{}</script><script src="/_next/static/chunks/main.js"></script>' });
    expect(namesOf(detectFrontend(signals))).toContain("Next.js");
  });

  it("detects React from legacy data-reactroot", () => {
    const signals = buildSignals({ html: '<div id="root" data-reactroot=""></div>' });
    expect(namesOf(detectFrontend(signals))).toContain("React");
  });

  it("detects React 18 from Suspense/streaming hydration markers", () => {
    const signals = buildSignals({ html: "<div><!--$--><h1>Hello</h1><!--/$--></div>" });
    expect(namesOf(detectFrontend(signals))).toContain("React");
  });

  it("detects Vue from scoped-style data-v-* attributes", () => {
    const signals = buildSignals({ html: '<div data-v-7ba5bd90 class="app"></div>' });
    expect(namesOf(detectFrontend(signals))).toContain("Vue");
  });

  it("detects Vue/React/Angular from a real script src, but not from prose merely mentioning the name — real bug found testing against a live Wikipedia article whose body text discusses \"Vue.js\" and \"Angular\" as encyclopedic content", () => {
    const realScript = buildSignals({ scripts: [{ src: "/assets/vue.runtime.min.js", inline: null }] });
    expect(namesOf(detectFrontend(realScript))).toContain("Vue");

    const prose = buildSignals({ html: "<p>Popular frontend frameworks include React, Vue.js, and Angular, each with different tradeoffs.</p>" });
    const names = namesOf(detectFrontend(prose));
    expect(names).not.toContain("Vue");
    expect(names).not.toContain("Angular");
  });

  it("detects Nuxt from __NUXT__ and the #__nuxt mount point, alongside Vue", () => {
    const signals = buildSignals({ html: '<div id="__nuxt"></div><script>window.__NUXT__={}</script>' });
    const names = namesOf(detectFrontend(signals));
    expect(names).toContain("Nuxt");
  });

  it("detects Angular from the ng-version attribute", () => {
    const signals = buildSignals({ htmlAttributes: { "ng-version": "17.0.0" }, html: '<html ng-version="17.0.0">' });
    expect(namesOf(detectFrontend(signals))).toContain("Angular");
  });

  it("detects Angular from view-encapsulation attributes and <app-root>", () => {
    const signals = buildSignals({ html: "<app-root _nghost-abc-c0></app-root>" });
    expect(namesOf(detectFrontend(signals))).toContain("Angular");
  });

  it("detects Svelte/SvelteKit from scoped class hashes and /_app/immutable/", () => {
    const signals = buildSignals({ html: '<div class="container svelte-1a2b3c4"></div><script src="/_app/immutable/entry/start.js"></script>' });
    expect(namesOf(detectFrontend(signals))).toContain("Svelte");
  });

  it("detects Astro from <astro-island> and data-astro-cid", () => {
    const signals = buildSignals({ html: '<astro-island data-astro-cid-abc123></astro-island>' });
    expect(namesOf(detectFrontend(signals))).toContain("Astro");
  });

  it("detects Remix from __remixContext", () => {
    const signals = buildSignals({ html: "<script>window.__remixContext = {};</script>" });
    expect(namesOf(detectFrontend(signals))).toContain("Remix");
  });

  it("detects Gatsby from the ___gatsby mount point and /page-data/", () => {
    const signals = buildSignals({ html: '<div id="___gatsby"></div>', scripts: [{ src: "/page-data/app-data.json", inline: null }] });
    expect(namesOf(detectFrontend(signals))).toContain("Gatsby");
  });

  it("falls back to HTML Static Website when no framework signature matches but real HTML exists", () => {
    const signals = buildSignals({ html: "<html><body><h1>Plain static page</h1></body></html>" });
    const result = detectFrontend(signals);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("HTML Static Website");
  });

  it("returns no candidates for empty input", () => {
    expect(detectFrontend(buildSignals({ html: "" }))).toEqual([]);
  });
});

describe("detectFrontend — real websites", () => {
  const cases: [string, string][] = [
    ["https://nextjs.org", "Next.js"],
    ["https://vuejs.org", "Vue"],
    ["https://angular.dev", "Angular"],
    ["https://svelte.dev", "Svelte"],
    ["https://astro.build", "Astro"],
    ["https://www.gatsbyjs.com", "Gatsby"],
    ["https://nuxt.com", "Nuxt"],
  ];

  it.each(cases)("detects %s's own framework on its real live site (%s)", async (url, expected) => {
    const signals = await collectSignals(url);
    const names = detectFrontend(signals).map((c) => c.name);
    expect(names).toContain(expected);
  }, 30000);
});
