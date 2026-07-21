import { Router } from "express";
import { z } from "zod";
import { runTechDetection } from "../techdetect/techDetectOrchestrator.service";
import { TechDetectRecordService } from "../techdetect/techDetectRecord.service";
import { verifyApiKey, TokenBucketRateLimiter } from "../knowledge/security/accessControl";
import { recordAuditEvent } from "../knowledge/security/auditLog";
import { getSocketServer } from "../ws/socket";
import { AppError } from "../middleware/errorHandler";
import { logEvent } from "../utils/logger";
import { formatError } from "../utils/formatError";

export const techDetectRouter = Router();

const RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 20, refillPerSecond: 2 });

/** Same API_SECRET + per-caller rate-limit gate as /api/knowledge — a technology report (security posture included) is not something to leave unauthenticated. */
techDetectRouter.use((req, res, next) => {
  const apiKey = req.header("x-api-key");
  const expected = process.env.API_SECRET;
  const clientId = apiKey ?? req.ip ?? "unknown";

  if (!RATE_LIMIT.tryConsume(clientId)) {
    recordAuditEvent({ type: "rate_limited", detail: `client=${clientId} path=${req.path}` });
    next(new AppError(429, "Too many requests", "Slow down and try again shortly.", true));
    return;
  }

  if (!expected || !verifyApiKey(apiKey, expected)) {
    recordAuditEvent({ type: "access_denied", detail: `client=${clientId} path=${req.path}` });
    next(new AppError(401, "Invalid or missing API key", "Pass the installation's API_SECRET as the x-api-key header.", false));
    return;
  }

  next();
});

const startBodySchema = z.object({
  crawlJobId: z.string().min(1),
  socketId: z.string().min(1),
});

/** Kicks off technology detection for one completed Phase 2 crawl job and returns immediately — progress streams over the caller's Socket.IO room, mirroring /api/scan/start and /api/knowledge/build. */
techDetectRouter.post("/start", (req, res, next) => {
  try {
    const parsed = startBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true);
    }

    const io = getSocketServer();
    const { crawlJobId, socketId } = parsed.data;

    runTechDetection(databaseUrl, crawlJobId, (event) => {
      io.to(socketId).emit("techdetect:progress", event);
    })
      .then((result) => {
        if (result.success) {
          io.to(socketId).emit("techdetect:complete", result);
        } else {
          io.to(socketId).emit("techdetect:error", { crawlJobId, message: result.errorMessage });
        }
      })
      .catch((err) => {
        logEvent({ component: "techdetect-orchestrator", message: "Unhandled technology detection error", status: "error", error: formatError(err) });
        io.to(socketId).emit("techdetect:error", { crawlJobId, message: formatError(err) });
      });

    res.json({ success: true, data: { started: true } });
  } catch (err) {
    next(err);
  }
});

/** Fetches the persisted technology report for a crawl job, if one has been generated. */
techDetectRouter.get("/:crawlJobId", async (req, res, next) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    next(new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true));
    return;
  }

  const records = new TechDetectRecordService(databaseUrl);
  try {
    const report = await records.getReport(req.params.crawlJobId);
    if (!report) {
      throw new AppError(404, "No technology report found for this crawl job", "Run POST /api/techdetect/start for this crawlJobId first.", false);
    }
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});
