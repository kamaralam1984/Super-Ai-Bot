import { Router } from "express";
import { z } from "zod";
import { generateInstallationConfig } from "../services/config.service";
import { AppError } from "../middleware/errorHandler";

export const configurationRouter = Router();

const bodySchema = z.object({
  websiteName: z.string().min(2).max(100),
  websiteUrl: z.string().url(),
});

configurationRouter.post("/", async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    }
    const config = await generateInstallationConfig(parsed.data.websiteName, parsed.data.websiteUrl);
    // `config` intentionally contains zero secret material — see GeneratedConfig contract.
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});
