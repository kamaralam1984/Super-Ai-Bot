import { Router } from "express";
import { runEnvironmentValidation } from "../services/environment.service";

export const environmentRouter = Router();

environmentRouter.get("/", async (_req, res, next) => {
  try {
    const result = await runEnvironmentValidation();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
