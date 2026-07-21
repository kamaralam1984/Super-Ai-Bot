import { Router } from "express";
import { createDirectoryStructure } from "../services/directory.service";

export const directoryRouter = Router();

directoryRouter.post("/", async (_req, res, next) => {
  try {
    const result = await createDirectoryStructure();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
