// `rawBody` is populated by app.ts's express.json({ verify }) hook — the
// exact bytes the caller sent, needed for HMAC signature verification
// (routes/monitorWebhook.routes.ts), since re-serializing req.body via
// JSON.stringify is not guaranteed to reproduce the sender's exact byte
// sequence (key order, whitespace) that they signed.
import "express";

declare module "express-serve-static-core" {
  interface Request {
    rawBody?: Buffer;
  }
}
