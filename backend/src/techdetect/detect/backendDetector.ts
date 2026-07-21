import type { SiteSignals, DetectionCandidate } from "../types";
import { CandidateBuilder, htmlAndScriptsHaystack, cookieNamesHaystack, allHeadersHaystack, headerValue } from "./signalUtils";

/**
 * Detects the backend framework and (separately) the programming language
 * it implies. This category is inherently lower-precision than CMS or
 * frontend detection — a well-built backend framework leaves almost
 * nothing in the HTML a browser receives; most of what's detectable here
 * comes from session-cookie naming conventions, response headers, and
 * default CSRF field names, all of which a security-conscious deployment
 * can (and often does) rename or suppress. Documented honestly rather
 * than overstating confidence: see docs/TECH_DETECTION.md.
 */
export function detectBackendFramework(signals: SiteSignals): DetectionCandidate[] {
  const html = htmlAndScriptsHaystack(signals);
  const cookies = cookieNamesHaystack(signals);
  const headers = allHeadersHaystack(signals);
  const poweredBy = headerValue(signals, "x-powered-by");
  const server = headerValue(signals, "server");
  const builder = new CandidateBuilder();

  // Laravel (PHP)
  if (/laravel_session/i.test(cookies)) builder.add("Laravel", "laravel_session cookie present", 0.9);
  if (/name="_token"/i.test(html)) builder.add("Laravel", 'CSRF field name="_token" (Laravel\'s default) found', 0.6);
  if (/x-xsrf-token/i.test(headers)) builder.add("Laravel", "X-XSRF-TOKEN header convention (Laravel default) present", 0.4);

  // Symfony (PHP)
  if (/x-debug-token/i.test(headers)) builder.add("Symfony", "X-Debug-Token header (Symfony profiler, debug mode) present", 0.9);
  if (/symfony profiler|sf-toolbar/i.test(html)) builder.add("Symfony", "Symfony web debug toolbar markup found", 0.9);

  // CodeIgniter (PHP)
  if (/\bci_session\b/i.test(cookies)) builder.add("CodeIgniter", "ci_session cookie present", 0.85);

  // CakePHP (PHP)
  if (/\bcakephp\b/i.test(html) || /\bcakephp\b/i.test(headers)) builder.add("CakePHP", "\"cakephp\" referenced in markup/headers", 0.6);

  // Express.js (Node.js)
  if (/^express$/i.test(poweredBy.trim())) builder.add("Express.js", "X-Powered-By: Express header present", 0.9);
  if (/\bconnect\.sid\b/i.test(cookies)) builder.add("Express.js", "connect.sid cookie (express-session default) present", 0.75);

  // NestJS (Node.js) — Nest defaults to an Express adapter under the hood
  // and leaves almost no public marker of its own; this stays a weak,
  // honestly-low-confidence signal rather than inventing a false one.
  if (/x-powered-by:\s*express/i.test(headers) && /nest/i.test(html)) builder.add("NestJS", "Express adapter header present alongside a \"nest\" reference in markup/assets", 0.35);

  // FastAPI (Python)
  if (/^uvicorn$/i.test(server.trim())) builder.add("FastAPI", "Server: uvicorn header (FastAPI/Starlette's ASGI server) present", 0.75);
  if (/x-process-time/i.test(headers)) builder.add("FastAPI", "X-Process-Time header (a common FastAPI middleware convention) present", 0.4);

  // Django (Python)
  if (/csrfmiddlewaretoken/i.test(html)) builder.add("Django", "csrfmiddlewaretoken field (Django's default CSRF field name) found", 0.85);
  if (/\bcsrftoken\b|\bdjango_language\b|\bsessionid\b/i.test(cookies)) builder.add("Django", "Django-conventional cookie (csrftoken/sessionid) present", 0.5);

  // Flask (Python)
  if (/^werkzeug/i.test(server.trim())) builder.add("Flask", "Server: Werkzeug header (Flask's default dev server) present", 0.7);
  if (/\bsession=/i.test(cookies) && /^gunicorn$/i.test(server.trim())) builder.add("Flask", "generic \"session\" cookie behind a gunicorn server", 0.3);

  // Spring Boot (Java)
  if (/apache-coyote/i.test(server)) builder.add("Spring Boot", "Server: Apache-Coyote header (Spring Boot's default embedded Tomcat) present", 0.85);
  if (/\bJSESSIONID\b/.test(cookies)) builder.add("Spring Boot", "JSESSIONID cookie (Java servlet container default) present", 0.5);

  // ASP.NET
  if (/asp\.net/i.test(poweredBy)) builder.add("ASP.NET", `X-Powered-By header: "${poweredBy}"`, 0.9);
  if (/__VIEWSTATE/i.test(html)) builder.add("ASP.NET", "__VIEWSTATE hidden field (ASP.NET WebForms) found", 0.9);
  if (/\.aspnetcore\.session|asp\.net_sessionid/i.test(cookies)) builder.add("ASP.NET", "ASP.NET session cookie present", 0.85);
  if (/x-aspnet-version|x-aspnetmvc-version/i.test(headers)) builder.add("ASP.NET", "X-AspNet(Mvc)-Version header present", 0.9);
  if (/^microsoft-iis/i.test(server.trim())) builder.add("ASP.NET", "Server: Microsoft-IIS header present", 0.5);

  // Ruby on Rails
  if (/authenticity_token/i.test(html)) builder.add("Ruby on Rails", 'CSRF field name="authenticity_token" (Rails default) found', 0.85);
  if (/x-request-id/i.test(headers) && /data-turbo|data-controller=/i.test(html)) builder.add("Ruby on Rails", "X-Request-Id header alongside Hotwire/Stimulus data attributes", 0.6);
  if (/_session_id=|_rails_session/i.test(cookies)) builder.add("Ruby on Rails", "Rails-conventional session cookie name found", 0.5);

  // Go (bare net/http or a minimal framework) — genuinely hard to detect
  // from public signals alone; net/http sets no distinctive Server header
  // by default. Only a framework-specific header is trustworthy enough to
  // include.
  if (/^fiber$/i.test(poweredBy.trim())) builder.add("Go", "X-Powered-By: Fiber header (a Go web framework) present", 0.8);

  const candidates = builder.build();

  if (candidates.length === 0 && signals.html.trim().length > 0) {
    return [{ name: "Custom Backend", matches: [{ signal: "No known backend framework signature matched", weight: 0.25 }] }];
  }

  return candidates;
}

const FRAMEWORK_TO_LANGUAGE: Record<string, string> = {
  Laravel: "PHP",
  Symfony: "PHP",
  CodeIgniter: "PHP",
  CakePHP: "PHP",
  "Express.js": "JavaScript",
  NestJS: "TypeScript",
  FastAPI: "Python",
  Django: "Python",
  Flask: "Python",
  "Spring Boot": "Java",
  "ASP.NET": "C#",
  "Ruby on Rails": "Ruby",
  Go: "Go",
};

/**
 * Programming language is mostly *implied* by the detected backend
 * framework (Laravel implies PHP, Django implies Python, ...) plus a
 * small number of direct signals independent of any specific framework
 * (a generic PHP-powered site with no recognized framework, or a raw
 * `.php`/`.aspx` asset extension). TypeScript is only inferred from a
 * strong proxy (NestJS) rather than a generic regex, since TypeScript
 * compiles away entirely and is otherwise indistinguishable from
 * JavaScript in anything a browser receives.
 */
export function detectProgrammingLanguages(signals: SiteSignals, backendCandidates: DetectionCandidate[]): DetectionCandidate[] {
  const html = htmlAndScriptsHaystack(signals);
  const headers = allHeadersHaystack(signals);
  const poweredBy = headerValue(signals, "x-powered-by");
  const builder = new CandidateBuilder();

  for (const candidate of backendCandidates) {
    const language = FRAMEWORK_TO_LANGUAGE[candidate.name];
    if (!language) continue;
    const strongestMatch = candidate.matches.reduce((best, m) => (m.weight > best.weight ? m : best), candidate.matches[0]);
    builder.add(language, `implied by detected backend framework "${candidate.name}" (${strongestMatch.signal})`, strongestMatch.weight * 0.9);
  }

  if (/^php\//i.test(poweredBy)) builder.add("PHP", `X-Powered-By header: "${poweredBy}"`, 0.9);
  else if (/\.php(\?|"|'|$)/i.test(html)) builder.add("PHP", ".php file extension referenced in markup", 0.4);

  if (/\.aspx(\?|"|'|$)|\.ashx(\?|"|'|$)/i.test(html)) builder.add("C#", ".aspx/.ashx file extension referenced in markup", 0.5);

  if (/x-generator:\s*drupal|x-generator:\s*joomla/i.test(headers)) builder.add("PHP", "PHP-based CMS X-Generator header present", 0.5);

  // Server-header-implied language, independent of pinning an exact
  // framework — real gap found testing against pypi.org (Server: gunicorn,
  // no cookies on the homepage GET, so no framework-specific signal fired
  // at all even though the language is clearly inferable from the WSGI
  // server alone).
  const server = headerValue(signals, "server").toLowerCase();
  if (/^gunicorn|^uvicorn|^werkzeug|^waitress/.test(server)) builder.add("Python", `Server header ("${headerValue(signals, "server")}") is a Python WSGI/ASGI server`, 0.6);
  if (/^apache-coyote/.test(server)) builder.add("Java", `Server header ("${headerValue(signals, "server")}") is Java's embedded Tomcat connector`, 0.6);

  // Every site with any client-side script at all runs JavaScript in the
  // browser — a near-universal, deliberately low-weight baseline signal
  // (not "this backend is written in JS", just "JavaScript executes here"),
  // distinct from the framework-implied JavaScript/TypeScript entries above.
  if (signals.scripts.length > 0) builder.add("JavaScript", `${signals.scripts.length} <script> tag(s) present on the page`, 0.3);

  return builder.build();
}
