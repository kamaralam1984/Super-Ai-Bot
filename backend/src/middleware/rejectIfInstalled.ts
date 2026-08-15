import type { NextFunction, Request, Response } from "express";
import { isInstalled } from "../config/env";
import { AppError } from "./errorHandler";

/**
 * Guards the mutating installer-wizard endpoints (Configuration, Database
 * initialize/rollback, the install orchestrator's start) — every one of them
 * is unauthenticated by necessity, since no API_SECRET exists until the
 * Configuration step generates one. Without this guard, anyone who can reach
 * an already-installed instance's HTTP port can re-run those steps: generate
 * fresh secrets (invalidating every admin session) and point DATABASE_URL at
 * a brand-new, empty database, orphaning all real data with no error at any
 * step — a silent, unauthenticated production reset.
 */
export function rejectIfInstalled(req: Request, res: Response, next: NextFunction): void {
  if (isInstalled()) {
    next(
      new AppError(
        409,
        "This installation is already complete",
        "This instance has already been installed and is serving live data. Re-running the installer would generate new secrets and a new, empty database, orphaning existing data. Delete the installation record and .env manually first if a genuine reinstall is intended.",
        false
      )
    );
    return;
  }
  next();
}
