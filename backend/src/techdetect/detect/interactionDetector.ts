import type { SiteSignals, DetectionCandidate, ParsedFormTag } from "../types";
import { CandidateBuilder, htmlAndScriptsHaystack, cookieNamesHaystack } from "./signalUtils";

/** Login/social/OTP/token-based authentication method detection. */
export function detectAuthentication(signals: SiteSignals): DetectionCandidate[] {
  const html = htmlAndScriptsHaystack(signals);
  const cookies = cookieNamesHaystack(signals);
  const builder = new CandidateBuilder();

  if (/accounts\.google\.com\/gsi\/client/i.test(html)) builder.add("Google Login", "Google Identity Services script referenced", 0.9);
  if (/class="[^"]*\bg_id_signin\b/i.test(html)) builder.add("Google Login", "g_id_signin button class found", 0.7);

  if (/FB\.login\s*\(/i.test(html)) builder.add("Facebook Login", "FB.login(...) call found", 0.85);
  if (/class="[^"]*\bfb-login-button\b/i.test(html)) builder.add("Facebook Login", "fb-login-button class found", 0.8);

  if (/appleid\.cdn-apple\.com/i.test(html)) builder.add("Apple Login", "Apple ID JS SDK script referenced", 0.9);
  if (/AppleID\.auth\.init\s*\(/i.test(html)) builder.add("Apple Login", "AppleID.auth.init(...) call found", 0.85);

  if (/login\.microsoftonline\.com|login\.live\.com/i.test(html)) builder.add("Microsoft Login", "Microsoft login domain referenced", 0.85);
  if (/@azure\/msal-browser|\bmsal\.js\b/i.test(html)) builder.add("Microsoft Login", "MSAL (Microsoft Authentication Library) referenced", 0.8);

  if (/\botp\b|one-time password|verification code/i.test(html) && signals.forms.some((f) => f.fields.some((field) => /otp|verification[-_ ]?code/i.test(field.name ?? "") || /otp|verification code/i.test(field.placeholder ?? "")))) {
    builder.add("OTP Login", "a form field named/placeholder-hinted for an OTP/verification code was found", 0.75);
  }

  if (/jwt_decode\s*\(|localStorage\.(get|set)Item\s*\(\s*['"]([a-z_]*token|jwt)['"]/i.test(html)) builder.add("JWT Authentication", "JWT decode call or token localStorage key referenced in inline script", 0.5);

  if (/response_type=code|\/oauth\/authorize/i.test(html)) builder.add("OAuth", "OAuth authorization-code flow URL pattern found", 0.6);

  const hasLoginForm = signals.forms.some((f) => f.fields.some((field) => field.type === "password") && f.fields.some((field) => /email|username|user/i.test(field.name ?? "")));
  if (hasLoginForm && /connect\.sid|phpsessid|jsessionid|sessionid/i.test(cookies)) {
    builder.add("Session Authentication", "a login form is present alongside a server-side session cookie", 0.55);
  }

  return builder.build();
}

const LIVE_CHAT_SIGNATURES: [RegExp, string, number][] = [
  [/embed\.tawk\.to/i, "Tawk.to", 0.9],
  [/widget\.intercom\.io/i, "Intercom", 0.9],
  [/client\.crisp\.chat/i, "Crisp", 0.9],
  [/static\.zdassets\.com|ekr\.zdassets\.com/i, "Zendesk", 0.9],
  [/wchat\.freshchat\.com/i, "Freshchat", 0.9],
  [/cdn\.livechatinc\.com/i, "LiveChat", 0.9],
  [/js\.driftt\.com/i, "Drift", 0.9],
  [/js\.hs-scripts\.com|static\.hsappstatic\.net/i, "HubSpot Chat", 0.85],
];

/** Live chat widget detection from each vendor's distinctive embed script domain. */
export function detectLiveChat(signals: SiteSignals): DetectionCandidate[] {
  const html = htmlAndScriptsHaystack(signals);
  const builder = new CandidateBuilder();

  for (const [pattern, name, weight] of LIVE_CHAT_SIGNATURES) {
    if (pattern.test(html)) builder.add(name, `${name} embed script domain referenced`, weight);
  }
  if (/window\.\$crisp\b/i.test(html)) builder.add("Crisp", "window.$crisp global referenced", 0.7);
  if (/\bIntercom\s*\(\s*['"]boot['"]/i.test(html)) builder.add("Intercom", "Intercom('boot',...) call found", 0.7);

  const candidates = builder.build();
  if (candidates.length > 0) return candidates;

  if (/class="[^"]*\b(chat-widget|chat-bubble|live-chat)\b/i.test(html)) {
    return [{ name: "Custom Chat", matches: [{ signal: "chat-widget/chat-bubble-looking element found, but no known live-chat vendor script matched", weight: 0.3 }] }];
  }
  return [];
}

type FormCategory =
  | "Contact Forms"
  | "Newsletter Forms"
  | "Lead Forms"
  | "Appointment Forms"
  | "Checkout Forms"
  | "Login Forms"
  | "Registration Forms"
  | "Search Forms";

function fieldNames(form: ParsedFormTag): string {
  return form.fields.map((f) => `${f.name ?? ""} ${f.placeholder ?? ""}`).join(" ").toLowerCase();
}

function formContext(form: ParsedFormTag): string {
  return `${form.action ?? ""} ${form.id ?? ""} ${form.className ?? ""}`.toLowerCase();
}

function classifyForm(form: ParsedFormTag): FormCategory | null {
  const names = fieldNames(form);
  const context = formContext(form);
  const passwordFieldCount = form.fields.filter((f) => f.type === "password").length;
  const hasEmail = /email|e-mail/.test(names) || form.fields.some((f) => f.type === "email");
  // Plain substring test, not \b-bounded: "full_name"/"first_name" are each
  // one contiguous \w token (underscore counts as a word character), so
  // `\bname\b` never matches inside them — caught by a synthetic test with
  // a "full_name" field that a strict word-boundary check silently missed.
  const hasName = /name/.test(names);
  const hasPhone = /phone|mobile|tel\b/.test(names) || form.fields.some((f) => f.type === "tel");

  // Requires an actual password field, not just a "signup"/"register"
  // context keyword alone — "newsletter-signup" as a form's class name
  // legitimately contains the substring "signup" without being an account
  // registration form at all (caught by a synthetic newsletter-form test).
  if (passwordFieldCount >= 2 || (passwordFieldCount === 1 && /register|signup|sign-up|create[-_]?account/.test(context))) return "Registration Forms";
  if (passwordFieldCount === 1 && (hasEmail || /login|sign-in|signin/.test(context))) return "Login Forms";
  if (/search/.test(context) || form.fields.some((f) => f.type === "search") || (form.method === "get" && form.fields.length === 1 && /^q$|search/.test(names))) return "Search Forms";
  if (/checkout|billing|shipping|payment|cart/.test(context) || form.fields.some((f) => /card[-_]?number|cvv|expiry/.test(f.name ?? ""))) return "Checkout Forms";
  if (/appointment|booking|schedule|reservation/.test(context) || /appointment|booking date|preferred date/.test(names)) return "Appointment Forms";
  if (/newsletter|subscribe/.test(context) || (hasEmail && form.fields.length <= 2 && !hasName)) return "Newsletter Forms";
  if (/contact/.test(context) || (hasName && hasEmail && names.includes("message"))) return "Contact Forms";
  if (hasName && hasEmail && hasPhone) return "Lead Forms";

  return null;
}

/** Classifies every <form> on the page into the spec's form-purpose categories — a page can (and usually does) have more than one kind of form. */
export function detectForms(signals: SiteSignals): DetectionCandidate[] {
  const builder = new CandidateBuilder();

  signals.forms.forEach((form, index) => {
    const category = classifyForm(form);
    if (!category) return;
    const label = form.id ? `#${form.id}` : form.action ? `action="${form.action}"` : `form[${index}]`;
    builder.add(category, `form ${label} matches the ${category.toLowerCase()} pattern`, 0.6);
  });

  return builder.build();
}
