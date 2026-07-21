import { Router } from "express";
import { z } from "zod";
import { runWebsiteScan } from "../scanner/scanOrchestrator.service";
import { getActiveInstallationId } from "../scanner/scanRecord.service";
import { getSocketServer } from "../ws/socket";
import { AppError } from "../middleware/errorHandler";
import { logEvent } from "../utils/logger";
import { formatError } from "../utils/formatError";

export const scanRouter = Router();

const bodySchema = z.object({
  websiteUrl: z.string().url(),
  socketId: z.string().min(1),
  maxDepth: z.number().int().min(1).max(10).optional(),
  maxPages: z.number().int().min(1).max(2000).optional(),
  concurrency: z.number().int().min(1).max(20).optional(),
});

/**
 * Kicks off the website scan pipeline and returns immediately — matches
 * Phase 1's install:start pattern exactly. All real progress streams to the
 * caller's own Socket.IO room as `scan:progress`, ending in `scan:complete`
 * or `scan:error`.
 */
scanRouter.post("/start", async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new AppError(400, "No database configured", "Complete the installer (Phase 1) before running a website scan.", true);
    }
    const installationId = await getActiveInstallationId(databaseUrl);
    if (!installationId) {
      throw new AppError(400, "No completed installation found", "Complete the installer (Phase 1) before running a website scan.", true);
    }

    const io = getSocketServer();
    const { socketId, websiteUrl, ...scanOptions } = parsed.data;

    runWebsiteScan(databaseUrl, installationId, websiteUrl, scanOptions, (event) => {
      io.to(socketId).emit("scan:progress", event);
    })
      .then((result) => {
        if (result.success) {
          io.to(socketId).emit("scan:complete", { crawlJobId: result.crawlJobId, report: result.report });
        } else {
          io.to(socketId).emit("scan:error", { crawlJobId: result.crawlJobId, message: result.errorMessage });
        }
      })
      .catch((err) => {
        logEvent({ component: "scan-orchestrator", message: "Unhandled scan error", status: "error", error: formatError(err) });
        io.to(socketId).emit("scan:error", { crawlJobId: null, message: formatError(err) });
      });

    res.json({ success: true, data: { started: true } });
  } catch (err) {
    next(err);
  }
});
