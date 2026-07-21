import { Router } from "express";
import { z } from "zod";
import { runAiTraining } from "../training/trainingOrchestrator.service";
import { runPostTrainingMonitoring } from "../monitor/monitorOrchestrator.service";
import { TrainingRecordService } from "../training/trainingRecord.service";
import { RetrainScheduler } from "../training/retrain/retrainScheduler";
import { AuthorizedTrainingRecordService } from "../permission/integration/authorizedTrainingRecordService";
import { PermissionOrchestratorService } from "../permission/permissionOrchestrator.service";
import { verifyApiKey, TokenBucketRateLimiter } from "../knowledge/security/accessControl";
import { recordAuditEvent } from "../knowledge/security/auditLog";
import { getSocketServer } from "../ws/socket";
import { AppError } from "../middleware/errorHandler";
import { logEvent } from "../utils/logger";
import { formatError } from "../utils/formatError";

export const trainingRouter = Router();

const RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 20, refillPerSecond: 2 });

trainingRouter.use((req, res, next) => {
  const apiKey = req.header("x-api-key");
  const expected = process.env.API_SECRET;
  const clientId = apiKey ?? req.ip ?? "unknown";

  if (!RATE_LIMIT.tryConsume(clientId)) {
    recordAuditEvent({ type: "rate_limited", detail: `client=${clientId} path=${req.path}`, component: "training-security" });
    next(new AppError(429, "Too many requests", "Slow down and try again shortly.", true));
    return;
  }

  if (!expected || !verifyApiKey(apiKey, expected)) {
    recordAuditEvent({ type: "access_denied", detail: `client=${clientId} path=${req.path}`, component: "training-security" });
    next(new AppError(401, "Invalid or missing API key", "Pass the installation's API_SECRET as the x-api-key header.", false));
    return;
  }

  next();
});

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true);
  }
  return databaseUrl;
}

function runTrainingWithSocketProgress(crawlJobId: string, socketId: string): void {
  const databaseUrl = requireDatabaseUrl();
  const io = getSocketServer();

  runAiTraining(databaseUrl, crawlJobId, (event) => {
    io.to(socketId).emit("training:progress", event);
  })
    .then((result) => {
      if (result.success) {
        io.to(socketId).emit("training:complete", result);
        if (result.chunkStats) {
          runPostTrainingMonitoring(databaseUrl, crawlJobId, result.chunkStats).catch((err) => {
            logEvent({ component: "monitor-orchestrator", message: "Unhandled post-training monitoring error", status: "error", error: formatError(err) });
          });
        }
      } else {
        io.to(socketId).emit("training:error", { crawlJobId, message: result.errorMessage });
      }
    })
    .catch((err) => {
      logEvent({ component: "training-orchestrator", message: "Unhandled AI training error", status: "error", error: formatError(err) });
      io.to(socketId).emit("training:error", { crawlJobId, message: formatError(err) });
    });
}

const startBodySchema = z.object({
  crawlJobId: z.string().min(1),
  socketId: z.string().min(1),
});

/** Kicks off the full Phase 6 pipeline for one crawl job and returns immediately — progress streams over the caller's Socket.IO room, mirroring /api/knowledge/build and /api/techdetect/start. Automatically incremental when a prior completed crawl job exists for the same installation+website; a full build otherwise. */
trainingRouter.post("/start", (req, res, next) => {
  try {
    const parsed = startBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }
    runTrainingWithSocketProgress(parsed.data.crawlJobId, parsed.data.socketId);
    res.json({ success: true, data: { started: true } });
  } catch (err) {
    next(err);
  }
});

/** Manually triggers a retrain for a crawl job — functionally identical to /start, but recorded/labeled distinctly for the "manual retraining" spec requirement (an operator explicitly asking, not a schedule or an auto-change-detection trigger). */
trainingRouter.post("/retrain", (req, res, next) => {
  try {
    const parsed = startBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }
    recordAuditEvent({ type: "training_retrain_requested", detail: `Manual retrain requested for crawlJobId=${parsed.data.crawlJobId}`, component: "training-security" });
    runTrainingWithSocketProgress(parsed.data.crawlJobId, parsed.data.socketId);
    res.json({ success: true, data: { started: true } });
  } catch (err) {
    next(err);
  }
});

// One process-wide scheduler — same "single long-running Node process per
// self-hosted installation" model every other background mechanism in
// this product assumes (see retrainScheduler.ts's module doc comment).
// socketId isn't part of RetrainScheduler's own config (it's a route-layer
// concern, not the scheduler's), so it's tracked here alongside the
// scheduler's own handleId.
const scheduleSocketIds = new Map<string, string>();
const scheduler = new RetrainScheduler((trigger) => {
  const socketId = scheduleSocketIds.get(`${trigger.installationId}:${trigger.crawlJobId}`);
  if (!socketId) return;
  runTrainingWithSocketProgress(trigger.crawlJobId, socketId);
});

const scheduleBodySchema = z.object({
  installationId: z.string().min(1),
  crawlJobId: z.string().min(1),
  intervalMs: z.number().int().min(60_000),
  socketId: z.string().min(1),
});

/** Registers a recurring scheduled retrain (in-process — see retrainScheduler.ts for the documented "doesn't survive a restart" limitation). */
trainingRouter.post("/schedule", (req, res, next) => {
  const parsed = scheduleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    next(new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true));
    return;
  }
  try {
    const { installationId, crawlJobId, intervalMs, socketId } = parsed.data;
    const handleId = scheduler.scheduleRecurring({ installationId, crawlJobId, intervalMs });
    scheduleSocketIds.set(`${installationId}:${crawlJobId}`, socketId);
    res.json({ success: true, data: { handleId } });
  } catch (err) {
    next(err);
  }
});

trainingRouter.get("/schedule", (_req, res) => {
  res.json({ success: true, data: scheduler.listScheduled() });
});

trainingRouter.delete("/schedule/:handleId", (req, res) => {
  const cancelled = scheduler.cancelRecurring(req.params.handleId);
  res.json({ success: true, data: { cancelled } });
});

/** Fetches the persisted TrainingReport for a crawl job. */
trainingRouter.get("/report/:crawlJobId", async (req, res, next) => {
  const records = new TrainingRecordService(requireDatabaseUrl());
  try {
    const report = await records.getTrainingReport(req.params.crawlJobId);
    if (!report) {
      throw new AppError(404, "No training report found for this crawl job", "Run POST /api/training/start for this crawlJobId first.", false);
    }
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

/** Chronological training-run history for an installation — the "Knowledge Timeline" view. */
trainingRouter.get("/reports", async (req, res, next) => {
  const installationId = typeof req.query.installationId === "string" ? req.query.installationId : undefined;
  if (!installationId) {
    next(new AppError(400, "installationId query parameter is required", "Pass ?installationId=... .", true));
    return;
  }
  const records = new TrainingRecordService(requireDatabaseUrl());
  try {
    const reports = await records.listTrainingReports(installationId);
    res.json({ success: true, data: reports });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

/** The knowledge relationship graph for an installation — permission-checked per edge (see permission/integration/authorizedTrainingRecordService.ts) since a relationship can expose which Products/Services/FAQs exist even without querying those tables directly. */
trainingRouter.get("/relationships", async (req, res, next) => {
  const installationId = typeof req.query.installationId === "string" ? req.query.installationId : undefined;
  if (!installationId) {
    next(new AppError(400, "installationId query parameter is required", "Pass ?installationId=... .", true));
    return;
  }
  const rawRecords = new TrainingRecordService(requireDatabaseUrl());
  const permissions = new PermissionOrchestratorService(requireDatabaseUrl());
  try {
    const records = new AuthorizedTrainingRecordService(rawRecords, permissions, installationId);
    const relationships = await records.getRelationshipsForInstallation(installationId);
    res.json({ success: true, data: relationships });
  } catch (err) {
    next(err);
  } finally {
    await rawRecords.close();
    await permissions.close();
  }
});
