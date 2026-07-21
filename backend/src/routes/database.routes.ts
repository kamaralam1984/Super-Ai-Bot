import { Router } from "express";
import { initializeDatabase, rollbackDatabase, getMigrationStatus } from "../services/database.service";
import { AppError } from "../middleware/errorHandler";

export const databaseRouter = Router();

function readDbCredentialsFromEnv(): { databaseName: string; databaseUser: string; databasePassword: string } {
  const databaseUrl = process.env.DATABASE_URL;
  const databasePassword = process.env.DB_PASSWORD;
  if (!databaseUrl || !databasePassword) {
    throw new AppError(400, "No database configuration found", "Run the Configuration step (Step 4) before initializing the database.", true);
  }
  const parsed = new URL(databaseUrl);
  return {
    databaseName: parsed.pathname.replace(/^\//, ""),
    databaseUser: parsed.username,
    databasePassword,
  };
}

databaseRouter.post("/initialize", async (_req, res, next) => {
  try {
    const credentials = readDbCredentialsFromEnv();
    const result = await initializeDatabase(credentials);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

databaseRouter.get("/status", async (_req, res, next) => {
  try {
    const status = await getMigrationStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
});

databaseRouter.post("/rollback", async (_req, res, next) => {
  try {
    const credentials = readDbCredentialsFromEnv();
    await rollbackDatabase(credentials);
    res.json({ success: true, data: { rolledBack: true } });
  } catch (err) {
    next(err);
  }
});
