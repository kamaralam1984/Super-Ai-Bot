import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { bootConfig, isInstalled } from "./config/env";
import { APP_ROOT } from "./config/paths";
import { apiRouter } from "./routes";
import { adminAuthRouter } from "./routes/adminAuth.routes";
import { widgetRouter } from "./routes/widget.routes";
import { injectApiKeyFromSession } from "./middleware/adminSession";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { metricsMiddleware, getMetrics } from "./deployment/monitoring/metrics";

export function createApp(): Express {
  const app = express();

  app.use(
    helmet({
      // The wizard UI is a same-origin SPA; CSP is tightened once the frontend
      // bundle hashes are known at build time (see docs/security-design.md).
      contentSecurityPolicy: bootConfig.NODE_ENV === "production" ? undefined : false,
    })
  );
  // Port must match vite.config.ts's dev server.port (3041) — a mismatch
  // here silently breaks credentialed (cookie-carrying) requests in dev,
  // since the browser CORS-blocks a cross-origin request whose origin
  // isn't explicitly allow-listed even before it reaches this server.
  app.use(cors({ origin: bootConfig.NODE_ENV === "development" ? "http://localhost:3041" : true, credentials: true }));
  app.use(
    express.json({
      limit: "1mb",
      // Retains the exact bytes the caller sent alongside the parsed body —
      // inbound webhook signature verification (routes/monitorWebhook.routes.ts)
      // must HMAC the sender's literal payload, not a re-serialized copy.
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = Buffer.from(buf);
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(metricsMiddleware);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", installed: isInstalled(), env: bootConfig.NODE_ENV, timestamp: new Date().toISOString() });
  });

  // Deliberately outside /api and never rate-limited/API-key-gated like
  // the deployment admin routes are — a Prometheus scraper on the
  // internal Docker network is the expected caller, not a browser.
  // See metrics.ts's own header comment for why this is safe to leave
  // unauthenticated (never proxied by the public nginx edge).
  app.get("/metrics", async (_req, res) => {
    const { contentType, body } = await getMetrics();
    res.set("Content-Type", contentType);
    res.send(body);
  });

  // Mounted before apiRouter (and unauthenticated itself — logging in IS
  // the point) so a valid dashboard session cookie can inject `x-api-key`
  // for every route inside apiRouter without any of those routes' own
  // auth middleware needing to change.
  app.use("/api/admin", adminAuthRouter);
  app.use("/api", injectApiKeyFromSession, apiRouter);
  // Public, unauthenticated, and outside /api on purpose — see
  // widget.routes.ts's own header comment.
  app.use(widgetRouter);

  const frontendDist = path.join(APP_ROOT, "frontend", "dist");
  if (bootConfig.NODE_ENV === "production" && fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get("*", (_req, res) => res.sendFile(path.join(frontendDist, "index.html")));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
