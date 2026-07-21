import { Router } from "express";
import { z } from "zod";
import { runInstallation } from "../services/installOrchestrator.service";
import { getSocketServer } from "../ws/socket";
import { AppError } from "../middleware/errorHandler";
import { logEvent } from "../utils/logger";
import { ALL_DATA_SCOPES } from "../permission/types";

export const installRouter = Router();

const bodySchema = z.object({
  websiteName: z.string().min(2).max(100),
  websiteUrl: z.string().url(),
  socketId: z.string().min(1),
  // What the pre-install permission screen (PermissionConsentStep.tsx) was
  // set to when the visitor clicked Continue — defaults to everything so a
  // caller that omits it (an old client build, a script) still ends up
  // with a working AI rather than a silently permission-less one.
  grantedScopes: z.array(z.enum(ALL_DATA_SCOPES as [string, ...string[]])).optional(),
});

/**
 * Kicks off the install pipeline and returns immediately — all progress is
 * streamed to the caller's own WebSocket room (their socketId) via
 * install:progress / install:error events, not via this HTTP response.
 */
installRouter.post("/start", async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }
    const io = getSocketServer();
    runInstallation(io, parsed.data.socketId, {
      websiteName: parsed.data.websiteName,
      websiteUrl: parsed.data.websiteUrl,
      grantedScopes: parsed.data.grantedScopes as never,
    }).catch((err) => {
      logEvent({ component: "install-orchestrator", message: "Unhandled installation error", status: "error", error: err instanceof Error ? err.message : String(err) });
    });
    res.json({ success: true, data: { started: true } });
  } catch (err) {
    next(err);
  }
});
