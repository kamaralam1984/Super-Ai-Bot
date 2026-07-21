import { describe, it, expect } from "vitest";
import { detectAnalytics } from "./analyticsDetector";
import { buildSignals } from "../testFixtures";
import { collectSignals } from "../signals/signalCollector";

function namesOf(result: ReturnType<typeof detectAnalytics>): string[] {
  return result.map((c) => c.name);
}

describe("detectAnalytics — synthetic signatures", () => {
  it("detects Google Analytics from the gtag script and config call", () => {
    const signals = buildSignals({ html: '<script src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script><script>gtag("config", "G-ABC1234567");</script>' });
    expect(namesOf(detectAnalytics(signals))).toContain("Google Analytics");
  });

  it("detects Google Tag Manager from the container script and GTM ID", () => {
    const signals = buildSignals({ html: '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABCD123"></script>' });
    expect(namesOf(detectAnalytics(signals))).toContain("Google Tag Manager");
  });

  it("detects Meta Pixel from fbevents.js and fbq init", () => {
    const signals = buildSignals({ html: '<script src="https://connect.facebook.net/en_US/fbevents.js"></script><script>fbq("init", "123456789");</script>' });
    expect(namesOf(detectAnalytics(signals))).toContain("Meta Pixel");
  });

  it("detects Hotjar from its script and hj() call", () => {
    const signals = buildSignals({ html: '<script src="https://static.hotjar.com/c/hotjar-123.js"></script><script>hj("event", "click");</script>' });
    expect(namesOf(detectAnalytics(signals))).toContain("Hotjar");
  });

  it("detects Microsoft Clarity from its script domain", () => {
    const signals = buildSignals({ html: '<script src="https://www.clarity.ms/tag/abc123"></script>' });
    expect(namesOf(detectAnalytics(signals))).toContain("Microsoft Clarity");
  });

  it("detects Mixpanel from its CDN script and init call", () => {
    const signals = buildSignals({ html: '<script src="https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js"></script><script>mixpanel.init("abc");</script>' });
    expect(namesOf(detectAnalytics(signals))).toContain("Mixpanel");
  });

  it("detects Amplitude from its CDN script and getInstance call", () => {
    const signals = buildSignals({ html: '<script src="https://cdn.amplitude.com/libs/amplitude-8-min.js"></script><script>amplitude.getInstance().init("abc");</script>' });
    expect(namesOf(detectAnalytics(signals))).toContain("Amplitude");
  });

  it("detects Matomo from matomo.js and _paq.push", () => {
    const signals = buildSignals({ html: '<script src="https://mysite.example/matomo.js"></script><script>_paq.push(["trackPageView"]);</script>' });
    expect(namesOf(detectAnalytics(signals))).toContain("Matomo");
  });

  it("detects LinkedIn Insight Tag from its script and partner id variable", () => {
    const signals = buildSignals({ html: '<script src="https://snap.licdn.com/li.lms-analytics/insight.min.js"></script><script>_linkedin_partner_id = "12345";</script>' });
    expect(namesOf(detectAnalytics(signals))).toContain("LinkedIn Insight Tag");
  });

  it("detects multiple independent analytics tools on the same page", () => {
    const signals = buildSignals({
      html: '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234"></script><script src="https://connect.facebook.net/en_US/fbevents.js"></script>',
    });
    const names = namesOf(detectAnalytics(signals));
    expect(names).toContain("Google Tag Manager");
    expect(names).toContain("Meta Pixel");
  });

  it("returns no candidates when nothing matches", () => {
    expect(detectAnalytics(buildSignals())).toEqual([]);
  });
});

describe("detectAnalytics — real websites", () => {
  it("detects Google Analytics on a real, live site that uses it", async () => {
    const signals = await collectSignals("https://wptavern.com");
    expect(namesOf(detectAnalytics(signals))).toContain("Google Analytics");
  }, 30000);
});
