import { Router } from "express";
import { runSystemCheck } from "../services/systemCheck.service";

export const systemCheckRouter = Router();

systemCheckRouter.get("/", async (_req, res, next) => {
  try {
    const result = await runSystemCheck();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
