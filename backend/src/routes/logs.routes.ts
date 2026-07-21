import { Router } from "express";
import { readRecentLogs } from "../utils/readLogs";

export const logsRouter = Router();

logsRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const entries = await readRecentLogs(limit);
    res.json({ success: true, data: { entries } });
  } catch (err) {
    next(err);
  }
});
