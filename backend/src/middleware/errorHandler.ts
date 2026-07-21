import type { NextFunction, Request, Response } from "express";
import { logEvent } from "../utils/logger";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly suggestedFix?: string,
    public readonly retryable: boolean = true
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Centralized error handler. Never leaks stack traces or secrets to the client. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : "Unexpected server error";

  logEvent({
    component: "http",
    message: `${req.method} ${req.path} failed: ${message}`,
    status: "error",
    error: message,
  });

  res.status(statusCode).json({
    success: false,
    error: {
      title: isAppError ? "Request failed" : "Internal server error",
      message,
      suggestedFix: isAppError ? err.suggestedFix ?? null : "Check server logs in logs/installer.log for details.",
      retryable: isAppError ? err.retryable : true,
    },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ success: false, error: { title: "Not found", message: `No route for ${req.method} ${req.path}`, retryable: false } });
}
