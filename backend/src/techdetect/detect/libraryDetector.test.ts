import { describe, it, expect } from "vitest";
import { detectJsLibraries, detectCssFrameworks } from "./libraryDetector";
import { buildSignals } from "../testFixtures";
import { collectSignals } from "../signals/signalCollector";

describe("detectJsLibraries — synthetic signatures", () => {
  it("detects jQuery from the script filename", () => {
    const signals = buildSignals({ scripts: [{ src: "/js/jquery-3.7.1.min.js", inline: null }] });
    expect(detectJsLibraries(signals).map((c) => c.name)).toContain("jQuery");
  });

  it("does not detect jQuery from prose merely mentioning the name — real bug found testing against a live Wikipedia article that discusses \"Vue.js\"/\"Angular\" as encyclopedic content without loading either", () => {
    const signals = buildSignals({ html: "<p>This site was built without jQuery, GSAP, or Chart.js.</p>" });
    const names = detectJsLibraries(signals).map((c) => c.name);
    expect(names).not.toContain("jQuery");
    expect(names).not.toContain("GSAP");
    expect(names).not.toContain("Chart.js");
  });

  it("detects Material UI from Mui*-root class names", () => {
    const signals = buildSignals({ html: '<button class="MuiButton-root MuiButton-contained">Click</button>' });
    expect(detectJsLibraries(signals).map((c) => c.name)).toContain("Material UI");
  });

  it("detects Ant Design from ant-* class names", () => {
    const signals = buildSignals({ html: '<button class="ant-btn ant-btn-primary">Click</button>' });
    expect(detectJsLibraries(signals).map((c) => c.name)).toContain("Ant Design");
  });

  it("detects Chakra UI from chakra-* class names", () => {
    const signals = buildSignals({ html: '<div class="chakra-stack chakra-box"></div>' });
    expect(detectJsLibraries(signals).map((c) => c.name)).toContain("Chakra UI");
  });

  it("detects GSAP from the script filename and plugin usage", () => {
    const signals = buildSignals({
      scripts: [{ src: "/vendor/gsap.min.js", inline: null }, { src: null, inline: 'gsap.to(".box", {x: 100});ScrollTrigger.create({})' }],
    });
    expect(detectJsLibraries(signals).map((c) => c.name)).toContain("GSAP");
  });

  it("detects Swiper from its class names and bundle filename", () => {
    const signals = buildSignals({
      html: '<div class="swiper-container"><div class="swiper-wrapper"></div></div>',
      scripts: [{ src: "/js/swiper-bundle.min.js", inline: null }],
    });
    expect(detectJsLibraries(signals).map((c) => c.name)).toContain("Swiper");
  });

  it("detects Three.js from the script filename and THREE.* usage", () => {
    const signals = buildSignals({ scripts: [{ src: "/js/three.min.js", inline: null }, { src: null, inline: "const scene = new THREE.Scene();" }] });
    expect(detectJsLibraries(signals).map((c) => c.name)).toContain("Three.js");
  });

  it("detects Chart.js from the script filename and new Chart() usage", () => {
    const signals = buildSignals({ scripts: [{ src: "/js/chart.min.js", inline: null }, { src: null, inline: 'new Chart(ctx, {type: "bar"});' }] });
    expect(detectJsLibraries(signals).map((c) => c.name)).toContain("Chart.js");
  });

  it("detects Recharts from its wrapper/surface class names", () => {
    const signals = buildSignals({ html: '<div class="recharts-wrapper"><svg class="recharts-surface"></svg></div>' });
    expect(detectJsLibraries(signals).map((c) => c.name)).toContain("Recharts");
  });

  it("returns no candidates when nothing matches", () => {
    expect(detectJsLibraries(buildSignals())).toEqual([]);
  });
});

describe("detectCssFrameworks — synthetic signatures", () => {
  it("detects Bootstrap from its stylesheet and utility class names", () => {
    const signals = buildSignals({
      html: '<div class="container-fluid"><button class="btn-primary">Go</button></div>',
      linkTags: [{ rel: "stylesheet", href: "/css/bootstrap.min.css", as: null }],
    });
    expect(detectCssFrameworks(signals).map((c) => c.name)).toContain("Bootstrap");
  });

  it("does not detect Bootstrap from prose merely mentioning the name", () => {
    const signals = buildSignals({ html: "<p>We migrated away from Bootstrap.css last year.</p>" });
    expect(detectCssFrameworks(signals).map((c) => c.name)).not.toContain("Bootstrap");
  });

  it("detects Tailwind CSS from responsive/state utility class prefixes", () => {
    const signals = buildSignals({ html: '<div class="flex items-center sm:px-4 md:px-6 hover:bg-blue-500 dark:bg-gray-900"></div>' });
    expect(detectCssFrameworks(signals).map((c) => c.name)).toContain("Tailwind CSS");
  });

  it("does not flag Tailwind from a single incidental colon-containing class", () => {
    const signals = buildSignals({ html: '<div class="hover:underline"></div>' });
    expect(detectCssFrameworks(signals).map((c) => c.name)).not.toContain("Tailwind CSS");
  });

  it("returns no candidates when nothing matches", () => {
    expect(detectCssFrameworks(buildSignals())).toEqual([]);
  });
});

describe("JS library / CSS framework detectors — real websites", () => {
  it("detects jQuery and Bootstrap on a real, live Bootstrap-templated site", async () => {
    const signals = await collectSignals("https://books.toscrape.com");
    expect(detectJsLibraries(signals).map((c) => c.name)).toContain("jQuery");
    expect(detectCssFrameworks(signals).map((c) => c.name)).toContain("Bootstrap");
  }, 30000);

  it("detects Tailwind CSS on tailwindcss.com's own real live site", async () => {
    const signals = await collectSignals("https://tailwindcss.com");
    expect(detectCssFrameworks(signals).map((c) => c.name)).toContain("Tailwind CSS");
  }, 30000);
});
