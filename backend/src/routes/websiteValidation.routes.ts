import { Router } from "express";
import { z } from "zod";
import { validateWebsite } from "../services/websiteValidation.service";
import { AppError } from "../middleware/errorHandler";

export const websiteValidationRouter = Router();

const bodySchema = z.object({
  websiteName: z.string().min(2).max(100),
  websiteUrl: z.string().min(4).max(2048),
});

websiteValidationRouter.post("/", async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }
    const result = await validateWebsite(parsed.data);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
