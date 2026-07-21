import { Router } from "express";
import { z } from "zod";
import { MonitorRecordService } from "../monitor/monitorRecord.service";
import { getScheduleRuntime } from "../monitor/monitorOrchestrator.service";
import { validateCronExpression, presetToCronExpression, type SchedulePreset } from "../monitor/schedule/cronScheduler";
import { getActiveInstallationId } from "../scanner/scanRecord.service";
import { verifyApiKey, TokenBucketRateLimiter } from "../knowledge/security/accessControl";
import { recordAuditEvent } from "../knowledge/security/auditLog";
import { AppError } from "../middleware/errorHandler";

export const monitorRouter = Router();

const RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 20, refillPerSecond: 2 });

/** Same internal-API-key + rate-limit convention as knowledge.routes.ts / training.routes.ts — every route here reads or manages operational/business data, not a customer-facing surface. */
monitorRouter.use((req, res, next) => {
  const apiKey = req.header("x-api-key");
  const expected = process.env.API_SECRET;
  const clientId = apiKey ?? req.ip ?? "unknown";

  if (!RATE_LIMIT.tryConsume(clientId)) {
    recordAuditEvent({ type: "rate_limited", detail: `client=${clientId} path=${req.path}`, component: "monitor-security" });
    next(new AppError(429, "Too many requests", "Slow down and try again shortly.", true));
    return;
  }
  if (!expected || !verifyApiKey(apiKey, expected)) {
    recordAuditEvent({ type: "access_denied", detail: `client=${clientId} path=${req.path}`, component: "monitor-security" });
    next(new AppError(401, "Invalid or missing API key", "Pass the installation's API_SECRET as the x-api-key header.", false));
    return;
  }
  next();
});

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true);
  return databaseUrl;
}

async function resolveInstallationId(databaseUrl: string, req: { query: Record<string, unknown> }): Promise<string> {
  const fromQuery = typeof req.query.installationId === "string" ? req.query.installationId : undefined;
  if (fromQuery) return fromQuery;
  const active = await getActiveInstallationId(databaseUrl);
  if (!active) throw new AppError(400, "No completed installation found", "Complete the installer (Phase 1) first.", true);
  return active;
}

// ── Knowledge Comparison Reports ─────────────────────────────────────────

monitorRouter.get("/reports", async (req, res, next) => {
  const databaseUrl = requireDatabaseUrl();
  const records = new MonitorRecordService(databaseUrl);
  try {
    const installationId = await resolveInstallationId(databaseUrl, req);
    const reports = await records.listComparisonReports(installationId);
    res.json({ success: true, data: reports });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

monitorRouter.get("/reports/:crawlJobId", async (req, res, next) => {
  const databaseUrl = requireDatabaseUrl();
  const records = new MonitorRecordService(databaseUrl);
  try {
    const report = await records.getComparisonReport(req.params.crawlJobId);
    if (!report) throw new AppError(404, "No comparison report found for this crawl job", undefined, false);
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

// ── Notifications ──────────────────────────────────────────────────────

monitorRouter.get("/notifications", async (req, res, next) => {
  const databaseUrl = requireDatabaseUrl();
  const records = new MonitorRecordService(databaseUrl);
  try {
    const installationId = await resolveInstallationId(databaseUrl, req);
    const notifications = await records.listNotifications(installationId);
    res.json({ success: true, data: notifications });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

monitorRouter.post("/notifications/:id/read", async (req, res, next) => {
  const databaseUrl = requireDatabaseUrl();
  const records = new MonitorRecordService(databaseUrl);
  try {
    await records.markNotificationRead(req.params.id);
    res.json({ success: true, data: { id: req.params.id } });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

const notificationSettingsSchema = z.object({
  installationId: z.string().min(1),
  emailEnabled: z.boolean().optional(),
  emailAddress: z.string().email().nullable().optional(),
  webhookEnabled: z.boolean().optional(),
  webhookUrl: z.string().url().nullable().optional(),
  enabledEmailTypes: z.array(z.string()).optional(),
  enabledWebhookTypes: z.array(z.string()).optional(),
});

monitorRouter.get("/notification-settings", async (req, res, next) => {
  const databaseUrl = requireDatabaseUrl();
  const records = new MonitorRecordService(databaseUrl);
  try {
    const installationId = await resolveInstallationId(databaseUrl, req);
    const settings = await records.getNotificationSettings(installationId);
    res.json({ success: true, data: settings });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

monitorRouter.put("/notification-settings", async (req, res, next) => {
  const databaseUrl = requireDatabaseUrl();
  const records = new MonitorRecordService(databaseUrl);
  try {
    const parsed = notificationSettingsSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    const { installationId, ...settings } = parsed.data;
    await records.upsertNotificationSettings(installationId, settings);
    res.json({ success: true, data: { installationId } });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

// ── Background Jobs ────────────────────────────────────────────────────

monitorRouter.get("/jobs", async (req, res, next) => {
  const databaseUrl = requireDatabaseUrl();
  const records = new MonitorRecordService(databaseUrl);
  try {
    const installationId = await resolveInstallationId(databaseUrl, req);
    const jobs = await records.listBackgroundJobs(installationId);
    res.json({ success: true, data: jobs });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

// ── Scheduled Recrawling ───────────────────────────────────────────────

monitorRouter.get("/schedules", async (req, res, next) => {
  const databaseUrl = requireDatabaseUrl();
  const records = new MonitorRecordService(databaseUrl);
  try {
    const installationId = await resolveInstallationId(databaseUrl, req);
    const schedules = await records.listScanSchedules(installationId);
    res.json({ success: true, data: schedules });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

const createScheduleSchema = z
  .object({
    installationId: z.string().min(1),
    crawlJobId: z.string().min(1),
    label: z.string().optional(),
  })
  .and(z.union([z.object({ preset: z.enum(["hourly", "daily", "weekly", "monthly"]) }), z.object({ cronExpression: z.string().min(1) })]));

/** Registers a scheduled recrawl — either a named preset (hourly/daily/weekly/monthly) or a raw cron expression, replaying `crawlJobId`'s website+options each time it fires. See monitor/schedule/cronScheduler.ts and monitorOrchestrator.service.ts's executeScheduledScan. */
monitorRouter.post("/schedules", async (req, res, next) => {
  const databaseUrl = requireDatabaseUrl();
  const records = new MonitorRecordService(databaseUrl);
  try {
    const parsed = createScheduleSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    const data = parsed.data as { installationId: string; crawlJobId: string; label?: string } & ({ preset: SchedulePreset } | { cronExpression: string });

    const cronExpression = "preset" in data ? presetToCronExpression(data.preset) : data.cronExpression;
    const validation = validateCronExpression(cronExpression);
    if (!validation.valid) throw new AppError(400, "Invalid cron expression", validation.errorMessage, true);

    const scheduleId = await records.createScanSchedule(data.installationId, data.crawlJobId, cronExpression, data.label ?? null);
    getScheduleRuntime().register(scheduleId, cronExpression);
    recordAuditEvent({ type: "training_schedule_created", detail: `scheduleId=${scheduleId} cron=${cronExpression} crawlJobId=${data.crawlJobId}`, component: "monitor-security" });

    res.json({ success: true, data: { scheduleId, cronExpression } });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

monitorRouter.patch("/schedules/:id", async (req, res, next) => {
  const databaseUrl = requireDatabaseUrl();
  const records = new MonitorRecordService(databaseUrl);
  try {
    const enabledSchema = z.object({ enabled: z.boolean() });
    const parsed = enabledSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);

    const schedule = await records.getScanSchedule(req.params.id);
    if (!schedule) throw new AppError(404, "Schedule not found", undefined, false);

    await records.updateScanScheduleEnabled(req.params.id, parsed.data.enabled);
    if (parsed.data.enabled) {
      const rows = await records.listScanSchedules(schedule.installationId);
      const row = rows.find((r) => r.id === req.params.id);
      if (row) getScheduleRuntime().register(req.params.id, row.cronExpression);
    } else {
      getScheduleRuntime().unregister(req.params.id);
    }

    res.json({ success: true, data: { id: req.params.id, enabled: parsed.data.enabled } });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});

monitorRouter.delete("/schedules/:id", async (req, res, next) => {
  const databaseUrl = requireDatabaseUrl();
  const records = new MonitorRecordService(databaseUrl);
  try {
    getScheduleRuntime().unregister(req.params.id);
    await records.deleteScanSchedule(req.params.id);
    recordAuditEvent({ type: "training_schedule_cancelled", detail: `scheduleId=${req.params.id}`, component: "monitor-security" });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  } finally {
    await records.close();
  }
});
