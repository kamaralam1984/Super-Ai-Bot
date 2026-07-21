import { describe, it, expect } from "vitest";
import { detectAuthentication, detectLiveChat, detectForms } from "./interactionDetector";
import { buildSignals } from "../testFixtures";
import { collectSignals } from "../signals/signalCollector";
import type { ParsedFormTag } from "../types";

function namesOf(result: { name: string }[]): string[] {
  return result.map((c) => c.name);
}

function form(overrides: Partial<ParsedFormTag>): ParsedFormTag {
  return { action: null, method: "post", id: null, className: null, fields: [], ...overrides };
}

describe("detectAuthentication — synthetic signatures", () => {
  it("detects Google Login from the Identity Services script and button class", () => {
    const signals = buildSignals({ html: '<script src="https://accounts.google.com/gsi/client"></script><div class="g_id_signin"></div>' });
    expect(namesOf(detectAuthentication(signals))).toContain("Google Login");
  });

  it("detects Facebook Login from FB.login() and the login button class", () => {
    const signals = buildSignals({ html: '<div class="fb-login-button"></div><script>FB.login(function(){});</script>' });
    expect(namesOf(detectAuthentication(signals))).toContain("Facebook Login");
  });

  it("detects Apple Login from the JS SDK and auth.init call", () => {
    const signals = buildSignals({ html: '<script src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"></script><script>AppleID.auth.init({});</script>' });
    expect(namesOf(detectAuthentication(signals))).toContain("Apple Login");
  });

  it("detects Microsoft Login from the login domain and MSAL reference", () => {
    const signals = buildSignals({ html: "window.location = 'https://login.microsoftonline.com/common/oauth2/authorize';" });
    expect(namesOf(detectAuthentication(signals))).toContain("Microsoft Login");
  });

  it("detects OTP Login from an OTP-named form field", () => {
    const signals = buildSignals({
      html: "Enter the verification code sent to your phone",
      forms: [form({ fields: [{ name: "otp_code", type: "text", placeholder: "Enter OTP" }] })],
    });
    expect(namesOf(detectAuthentication(signals))).toContain("OTP Login");
  });

  it("detects JWT Authentication from a token localStorage key", () => {
    const signals = buildSignals({ html: 'localStorage.setItem("token", response.jwt);' });
    expect(namesOf(detectAuthentication(signals))).toContain("JWT Authentication");
  });

  it("detects OAuth from an authorization-code flow URL pattern", () => {
    const signals = buildSignals({ html: '<a href="/oauth/authorize?response_type=code&client_id=abc">Connect</a>' });
    expect(namesOf(detectAuthentication(signals))).toContain("OAuth");
  });

  it("detects Session Authentication from a login form plus a session cookie", () => {
    const signals = buildSignals({
      forms: [form({ fields: [{ name: "email", type: "email", placeholder: null }, { name: "password", type: "password", placeholder: null }] })],
      cookies: ["connect.sid=abc123"],
    });
    expect(namesOf(detectAuthentication(signals))).toContain("Session Authentication");
  });

  it("returns no candidates when nothing matches", () => {
    expect(detectAuthentication(buildSignals())).toEqual([]);
  });
});

describe("detectLiveChat — synthetic signatures", () => {
  it("detects each vendor from its embed script domain", () => {
    const cases: [string, string][] = [
      ["https://embed.tawk.to/abc/default", "Tawk.to"],
      ["https://widget.intercom.io/widget/abc", "Intercom"],
      ["https://client.crisp.chat/l.js", "Crisp"],
      ["https://static.zdassets.com/ekr/snippet.js", "Zendesk"],
      ["https://wchat.freshchat.com/js/widget.js", "Freshchat"],
      ["https://cdn.livechatinc.com/tracking.js", "LiveChat"],
      ["https://js.driftt.com/include/abc.js", "Drift"],
      ["https://js.hs-scripts.com/12345.js", "HubSpot Chat"],
    ];
    for (const [src, expected] of cases) {
      const signals = buildSignals({ html: `<script src="${src}"></script>` });
      expect(namesOf(detectLiveChat(signals))).toContain(expected);
    }
  });

  it("falls back to Custom Chat when a chat-widget-looking element exists but no vendor matches", () => {
    const signals = buildSignals({ html: '<div class="chat-widget"></div>' });
    const result = detectLiveChat(signals);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Custom Chat");
  });

  it("returns no candidates when there is no chat widget at all", () => {
    expect(detectLiveChat(buildSignals())).toEqual([]);
  });
});

describe("detectForms — classification", () => {
  it("classifies a login form (single password + email field)", () => {
    const signals = buildSignals({
      forms: [form({ id: "login-form", fields: [{ name: "email", type: "email", placeholder: null }, { name: "password", type: "password", placeholder: null }] })],
    });
    expect(namesOf(detectForms(signals))).toContain("Login Forms");
  });

  it("classifies a registration form (two password fields)", () => {
    const signals = buildSignals({
      forms: [
        form({
          fields: [
            { name: "email", type: "email", placeholder: null },
            { name: "password", type: "password", placeholder: null },
            { name: "password_confirmation", type: "password", placeholder: null },
          ],
        }),
      ],
    });
    expect(namesOf(detectForms(signals))).toContain("Registration Forms");
  });

  it("classifies a newsletter form (email only, no name)", () => {
    const signals = buildSignals({ forms: [form({ className: "newsletter-signup", fields: [{ name: "email", type: "email", placeholder: "Your email" }] })] });
    expect(namesOf(detectForms(signals))).toContain("Newsletter Forms");
  });

  it("classifies a contact form (name + email + message)", () => {
    const signals = buildSignals({
      forms: [
        form({
          id: "contact-form",
          fields: [
            { name: "name", type: "text", placeholder: null },
            { name: "email", type: "email", placeholder: null },
            { name: "message", type: "text", placeholder: null },
          ],
        }),
      ],
    });
    expect(namesOf(detectForms(signals))).toContain("Contact Forms");
  });

  it("classifies a lead form (name + email + phone, no message)", () => {
    const signals = buildSignals({
      forms: [
        form({
          fields: [
            { name: "full_name", type: "text", placeholder: null },
            { name: "email", type: "email", placeholder: null },
            { name: "phone", type: "tel", placeholder: null },
          ],
        }),
      ],
    });
    expect(namesOf(detectForms(signals))).toContain("Lead Forms");
  });

  it("classifies an appointment/booking form", () => {
    const signals = buildSignals({ forms: [form({ id: "booking-form", fields: [{ name: "appointment_date", type: "date", placeholder: null }] })] });
    expect(namesOf(detectForms(signals))).toContain("Appointment Forms");
  });

  it("classifies a checkout form (card fields)", () => {
    const signals = buildSignals({ forms: [form({ action: "/checkout", fields: [{ name: "card_number", type: "text", placeholder: null }] })] });
    expect(namesOf(detectForms(signals))).toContain("Checkout Forms");
  });

  it("classifies a search form (single query field, GET method)", () => {
    const signals = buildSignals({ forms: [form({ method: "get", fields: [{ name: "q", type: "search", placeholder: null }] })] });
    expect(namesOf(detectForms(signals))).toContain("Search Forms");
  });

  it("classifies multiple different forms on the same page independently", () => {
    const signals = buildSignals({
      forms: [
        form({ method: "get", fields: [{ name: "q", type: "search", placeholder: null }] }),
        form({ className: "newsletter", fields: [{ name: "email", type: "email", placeholder: null }] }),
      ],
    });
    const names = namesOf(detectForms(signals));
    expect(names).toContain("Search Forms");
    expect(names).toContain("Newsletter Forms");
  });

  it("returns no candidates for a form with no classifiable pattern", () => {
    const signals = buildSignals({ forms: [form({ fields: [{ name: "random_field", type: "text", placeholder: null }] })] });
    expect(detectForms(signals)).toEqual([]);
  });

  it("returns no candidates when there are no forms at all", () => {
    expect(detectForms(buildSignals())).toEqual([]);
  });
});

describe("interactionDetector — real websites", () => {
  it("never crashes against a real, live site's forms/auth/chat signals", async () => {
    const signals = await collectSignals("https://books.toscrape.com");
    expect(() => detectAuthentication(signals)).not.toThrow();
    expect(() => detectLiveChat(signals)).not.toThrow();
    expect(() => detectForms(signals)).not.toThrow();
  }, 30000);
});
