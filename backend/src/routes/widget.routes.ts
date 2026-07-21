// Public embeddable chat widget (Phase 12) — the two files a client's own
// website actually loads: the tiny loader script (widget.js) and the
// standalone chat page it iframes (widget.html, at GET /widget).
//
// Read from disk once at module load rather than templated per-request:
// both files are static (they self-configure at runtime via
// document.currentScript / GET /api/chat/config), so there is nothing
// request-specific to interpolate. Sourced from backend/src/widget/ via
// BACKEND_ROOT (not __dirname + relative dist-walking) so this works
// identically under `tsx src/index.ts` (dev) and `node dist/index.js`
// (prod) without needing a build-step asset copy for two files that never
// need TypeScript compilation in the first place.
//
// Mounted at the app root (backend/src/app.ts), NOT under /api — a
// `<script src>` tag and an iframe both just need *a* URL, and keeping
// these off the JSON-API prefix keeps `/widget.js`/`/widget` readable as
// what they are: the public product surface, not an API call.

import path from "node:path";
import fs from "node:fs";
import { Router } from "express";
import { BACKEND_ROOT } from "../config/paths";

export const widgetRouter = Router();

const WIDGET_JS = fs.readFileSync(path.join(BACKEND_ROOT, "src", "widget", "widget.js"), "utf-8");
const WIDGET_HTML = fs.readFileSync(path.join(BACKEND_ROOT, "src", "widget", "widget.html"), "utf-8");

widgetRouter.get("/widget.js", (_req, res) => {
  // helmet()'s default `Cross-Origin-Resource-Policy: same-origin` blocks a
  // *client's* page from ever loading this script at all (Chrome fails the
  // request outright with ERR_BLOCKED_BY_RESPONSE.NotSameOrigin, before
  // the script even runs) — the exact opposite of a public embed's whole
  // point, so it's relaxed for this one file.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.type("application/javascript");
  // Short cache: this file rarely changes, but there is no cache-busting
  // filename hash on a plain `<script src="/widget.js">` embed, so an
  // aggressive cache would delay every client site picking up a fix.
  res.set("Cache-Control", "public, max-age=300");
  res.send(WIDGET_JS);
});

widgetRouter.get("/widget", (_req, res) => {
  // The one page in this product deliberately designed to be iframed from
  // an arbitrary third-party (client) domain. helmet() in app.ts sends
  // `X-Frame-Options: SAMEORIGIN`, a CSP with `frame-ancestors 'self'` (in
  // production), and `Cross-Origin-Resource-Policy: same-origin` on every
  // response by default — each of the three independently blocks
  // third-party framing (verified: Chrome enforces CORP even for iframe
  // loads, not just fetch/script), so all three are overridden here. The
  // production nginx edge (deploy/nginx/conf.d/kvl-locations.conf) carries
  // the X-Frame-Options/CSP equivalent at the reverse-proxy layer for
  // deployments that terminate there instead of hitting this process
  // directly.
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.type("text/html");
  res.set("Cache-Control", "no-store");
  res.send(WIDGET_HTML);
});
