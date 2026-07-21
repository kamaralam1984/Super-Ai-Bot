import { describe, it, expect } from "vitest";
import { detectBackendFramework, detectProgrammingLanguages } from "./backendDetector";
import { buildSignals } from "../testFixtures";
import { collectSignals } from "../signals/signalCollector";

function namesOf(result: ReturnType<typeof detectBackendFramework>): string[] {
  return result.map((c) => c.name);
}

describe("detectBackendFramework — synthetic signatures", () => {
  it("detects Laravel from laravel_session cookie", () => {
    const signals = buildSignals({ cookies: ["laravel_session=abc123; Path=/; HttpOnly"] });
    expect(namesOf(detectBackendFramework(signals))).toContain("Laravel");
  });

  it("detects Symfony from the X-Debug-Token header", () => {
    const signals = buildSignals({ headers: { "x-debug-token": "a1b2c3" } });
    expect(namesOf(detectBackendFramework(signals))).toContain("Symfony");
  });

  it("detects CodeIgniter from ci_session cookie", () => {
    const signals = buildSignals({ cookies: ["ci_session=xyz789"] });
    expect(namesOf(detectBackendFramework(signals))).toContain("CodeIgniter");
  });

  it("detects Express.js from the X-Powered-By header", () => {
    const signals = buildSignals({ headers: { "x-powered-by": "Express" } });
    expect(namesOf(detectBackendFramework(signals))).toContain("Express.js");
  });

  it("detects FastAPI from the uvicorn server header", () => {
    const signals = buildSignals({ headers: { server: "uvicorn" } });
    expect(namesOf(detectBackendFramework(signals))).toContain("FastAPI");
  });

  it("detects Django from the csrfmiddlewaretoken field", () => {
    const signals = buildSignals({ html: '<form><input type="hidden" name="csrfmiddlewaretoken" value="abc"></form>' });
    expect(namesOf(detectBackendFramework(signals))).toContain("Django");
  });

  it("detects Flask from the Werkzeug server header", () => {
    const signals = buildSignals({ headers: { server: "Werkzeug/2.3.0 Python/3.11" } });
    expect(namesOf(detectBackendFramework(signals))).toContain("Flask");
  });

  it("detects Spring Boot from the Apache-Coyote server header", () => {
    const signals = buildSignals({ headers: { server: "Apache-Coyote/1.1" } });
    expect(namesOf(detectBackendFramework(signals))).toContain("Spring Boot");
  });

  it("detects ASP.NET from __VIEWSTATE and X-Powered-By", () => {
    const signals = buildSignals({ html: '<input type="hidden" name="__VIEWSTATE" value="xyz">', headers: { "x-powered-by": "ASP.NET" } });
    expect(namesOf(detectBackendFramework(signals))).toContain("ASP.NET");
  });

  it("detects Ruby on Rails from the authenticity_token field", () => {
    const signals = buildSignals({ html: '<input type="hidden" name="authenticity_token" value="abc">' });
    expect(namesOf(detectBackendFramework(signals))).toContain("Ruby on Rails");
  });

  it("falls back to Custom Backend when no signature matches but real HTML exists", () => {
    const signals = buildSignals({ html: "<html><body>Plain page</body></html>" });
    const result = detectBackendFramework(signals);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Custom Backend");
  });

  it("returns no candidates for empty input", () => {
    expect(detectBackendFramework(buildSignals({ html: "" }))).toEqual([]);
  });
});

describe("detectProgrammingLanguages — synthetic signatures", () => {
  it("infers PHP from a detected Laravel backend", () => {
    const signals = buildSignals({ cookies: ["laravel_session=abc"] });
    const backend = detectBackendFramework(signals);
    const langs = detectProgrammingLanguages(signals, backend);
    expect(langs.map((c) => c.name)).toContain("PHP");
  });

  it("infers Python from a detected Django backend", () => {
    const signals = buildSignals({ html: '<input name="csrfmiddlewaretoken" value="x">' });
    const backend = detectBackendFramework(signals);
    const langs = detectProgrammingLanguages(signals, backend);
    expect(langs.map((c) => c.name)).toContain("Python");
  });

  it("infers Python directly from a gunicorn Server header even with no specific framework match", () => {
    // Real bug found testing against pypi.org: Server: gunicorn with no
    // cookies on the homepage GET meant no framework-specific signal fired
    // at all, yet the language is clearly inferable from the WSGI server.
    const signals = buildSignals({ headers: { server: "gunicorn" } });
    const backend = detectBackendFramework(signals);
    const langs = detectProgrammingLanguages(signals, backend);
    expect(langs.map((c) => c.name)).toContain("Python");
  });

  it("infers TypeScript from a detected NestJS backend", () => {
    const signals = buildSignals({ headers: { "x-powered-by": "Express" }, html: "nestjs application bundle" });
    const backend = detectBackendFramework(signals);
    const langs = detectProgrammingLanguages(signals, backend);
    expect(langs.map((c) => c.name)).toContain("TypeScript");
  });

  it("infers PHP from the X-Powered-By header directly, with no recognized framework", () => {
    const signals = buildSignals({ headers: { "x-powered-by": "PHP/8.2.10" } });
    const langs = detectProgrammingLanguages(signals, []);
    expect(langs.map((c) => c.name)).toContain("PHP");
  });

  it("always includes a low-weight JavaScript baseline when scripts are present", () => {
    const signals = buildSignals({ scripts: [{ src: "/main.js", inline: null }] });
    const langs = detectProgrammingLanguages(signals, []);
    const js = langs.find((c) => c.name === "JavaScript");
    expect(js).toBeDefined();
    expect(js!.matches[0].weight).toBeLessThan(0.5);
  });
});

describe("detectBackendFramework / detectProgrammingLanguages — real websites", () => {
  it("infers Python from pypi.org's real gunicorn server header", async () => {
    const signals = await collectSignals("https://pypi.org");
    const backend = detectBackendFramework(signals);
    const langs = detectProgrammingLanguages(signals, backend);
    expect(langs.map((c) => c.name)).toContain("Python");
  }, 30000);

  it("never crashes and always returns a non-empty backend result for a real, live site", async () => {
    const signals = await collectSignals("https://example.com");
    const backend = detectBackendFramework(signals);
    expect(backend.length).toBeGreaterThan(0);
  }, 30000);
});
