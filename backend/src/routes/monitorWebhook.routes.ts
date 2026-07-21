import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { runWebsiteScan } from "../scanner/scanOrchestrator.service";
import { getActiveInstallationId } from "../scanner/scanRecord.service";
import { verifyWebhookSignature } from "../monitor/notify/webhookChannel";
import { MonitorRecordService } from "../monitor/monitorRecord.service";
import { AppError } from "../middleware/errorHandler";
import { logEvent } from "../utils/logger";
import { formatError } from "../utils/formatError";

export const monitorWebhookRouter = Router();

const bodySchema = z.object({
  websiteUrl: z.string().url().optional(),
  maxDepth: z.number().int().min(1).max(10).optional(),
  maxPages: z.number().int().min(1).max(2000).optional(),
  concurrency: z.number().int().min(1).max(20).optional(),
});

/**
 * Inbound, HMAC-verified webhook that triggers an immediate on-demand
 * rescan — the "webhooks" trigger the spec's Scheduled Recrawling section
 * calls out alongside manual/hourly/daily/cron. Reuses the exact same
 * `runWebsiteScan` pipeline scan.routes.ts's manual "start scan" button
 * calls, so a webhook-triggered scan behaves identically to a manual one;
 * the only difference is how it's authenticated (HMAC signature over the
 * raw request body instead of an authenticated browser session) and that
 * it responds immediately with a job id rather than streaming progress
 * over a caller-supplied Socket.IO room (a webhook caller has no socket).
 */
monitorWebhookRouter.post("/webhook/scan", async (req, res, next) => {
  try {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
      throw new AppError(400, "Webhook trigger is not configured", "WEBHOOK_SECRET is not set for this installation.", false);
    }

    const signature = req.header("X-KVL-Signature");
    const rawBody = req.rawBody ? req.rawBody.toString("utf-8") : "";
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      throw new AppError(401, "Invalid webhook signature", "The X-KVL-Signature header did not match the expected HMAC of the request body.", false);
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new AppError(400, "No database configured", "Complete the installer (Phase 1) before triggering a scan.", true);
    }
    const installationId = await getActiveInstallationId(databaseUrl);
    if (!installationId) {
      throw new AppError(400, "No completed installation found", "Complete the installer (Phase 1) before triggering a scan.", true);
    }

    const records = new MonitorRecordService(databaseUrl);
    const { websiteUrl: overrideUrl, ...scanOptions } = parsed.data;
    const websiteUrl = overrideUrl ?? (await records.getInstallationWebsiteUrl(installationId));
    if (!websiteUrl) {
      await records.close();
      throw new AppError(400, "No website URL available", "Provide websiteUrl in the payload, or complete installation first.", true);
    }

    const jobId = await records.createBackgroundJob(installationId, "SCAN", { websiteUrl, ...scanOptions, trigger: "webhook" });
    await records.close();

    runWebsiteScan(databaseUrl, installationId, websiteUrl, scanOptions, () => {})
      .then(async (result) => {
        const jobRecords = new MonitorRecordService(databaseUrl);
        try {
          if (result.success) {
            await jobRecords.completeBackgroundJob(jobId);
          } else {
            await jobRecords.failBackgroundJob(jobId, result.errorMessage ?? "Scan failed for an unknown reason");
          }
        } finally {
          await jobRecords.close();
        }
      })
      .catch(async (err) => {
        logEvent({ component: "monitor-webhook", message: "Unhandled webhook-triggered scan error", status: "error", error: formatError(err) });
        const jobRecords = new MonitorRecordService(databaseUrl);
        try {
          await jobRecords.failBackgroundJob(jobId, formatError(err));
        } finally {
          await jobRecords.close();
        }
      });

    res.status(202).json({ success: true, data: { started: true, jobId, websiteUrl } });
  } catch (err) {
    next(err);
  }
});

/** No request body to HMAC on a GET, so status polling is gated by a plain shared-secret header instead — still constant-time, still never accepted from an unauthenticated caller (job status/error text can leak internal detail, e.g. a stack-trace-derived error message). */
function isAuthorizedPollRequest(req: { header(name: string): string | undefined }, secret: string): boolean {
  const provided = req.header("X-KVL-Secret");
  if (!provided) return false;
  const providedBuf = Buffer.from(provided, "utf-8");
  const secretBuf = Buffer.from(secret, "utf-8");
  if (providedBuf.length !== secretBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, secretBuf);
}

/** Poll endpoint for a webhook caller to check the outcome of a previously triggered scan, since the trigger response only returns a jobId. */
monitorWebhookRouter.get("/webhook/scan/:jobId", async (req, res, next) => {
  try {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret || !isAuthorizedPollRequest(req, secret)) {
      throw new AppError(401, "Unauthorized", "Provide the correct X-KVL-Secret header.", false);
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true);
    }
    const records = new MonitorRecordService(databaseUrl);
    const job = await records.getBackgroundJob(req.params.jobId);
    await records.close();
    if (!job) {
      throw new AppError(404, "Job not found", undefined, false);
    }
    res.json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
});
