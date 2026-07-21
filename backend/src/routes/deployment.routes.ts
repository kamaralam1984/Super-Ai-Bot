import { Router } from "express";
import { z } from "zod";
import { runHealthChecks } from "../deployment/health/healthCheckEngine";
import { getVersionInfo } from "../deployment/update/updateStatus.service";
import { runBackup, listBackups, pruneOldBackups } from "../deployment/backup/backupService";
import { discoverPluginDirectories, installPlugin, enablePlugin, disablePlugin, removePlugin, checkPluginHealth, listPlugins } from "../deployment/plugins/pluginService";
import { activateLicense, validateLicense, getLicenseStatus } from "../deployment/license/licenseService";
import { getActiveInstallationId } from "../scanner/scanRecord.service";
import { verifyApiKey, TokenBucketRateLimiter } from "../knowledge/security/accessControl";
import { recordAuditEvent } from "../knowledge/security/auditLog";
import { AppError } from "../middleware/errorHandler";

export const deploymentRouter = Router();

const RATE_LIMIT = new TokenBucketRateLimiter({ maxTokens: 20, refillPerSecond: 2 });

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new AppError(400, "No database configured", "Complete the installer (Phase 1) first.", true);
  return databaseUrl;
}

async function requireInstallationId(databaseUrl: string): Promise<string> {
  const installationId = await getActiveInstallationId(databaseUrl);
  if (!installationId) throw new AppError(400, "No completed installation found", "Complete the installer (Phase 1) first.", true);
  return installationId;
}

// `/health` is deliberately BEFORE the x-api-key gate below — an
// unauthenticated load balancer / uptime monitor needs to read it, and
// unlike the detailed report's individual check details (DB reachability
// info, connector counts), the aggregate pass/warn/fail status alone
// isn't sensitive. Every other route in this file stays behind the gate.
deploymentRouter.get("/health", async (_req, res, next) => {
  try {
    const report = await runHealthChecks();
    res.status(report.status === "fail" ? 503 : 200).json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

deploymentRouter.get("/version", (_req, res) => {
  res.json({ success: true, data: getVersionInfo() });
});

/** Same internal-API-key + rate-limit convention as knowledge.routes.ts / training.routes.ts / monitor.routes.ts. */
deploymentRouter.use((req, res, next) => {
  const apiKey = req.header("x-api-key");
  const expected = process.env.API_SECRET;
  const clientId = apiKey ?? req.ip ?? "unknown";

  if (!RATE_LIMIT.tryConsume(clientId)) {
    recordAuditEvent({ type: "rate_limited", detail: `client=${clientId} path=${req.path}`, component: "deployment-security" });
    next(new AppError(429, "Too many requests", "Slow down and try again shortly.", true));
    return;
  }
  if (!expected || !verifyApiKey(apiKey, expected)) {
    recordAuditEvent({ type: "access_denied", detail: `client=${clientId} path=${req.path}`, component: "deployment-security" });
    next(new AppError(401, "Invalid or missing API key", "Pass the installation's API_SECRET as the x-api-key header.", false));
    return;
  }
  next();
});

// ── Backup Manager ───────────────────────────────────────────────────────

deploymentRouter.get("/backups", async (_req, res, next) => {
  try {
    const databaseUrl = requireDatabaseUrl();
    const installationId = await requireInstallationId(databaseUrl);
    const backups = await listBackups(databaseUrl, installationId);
    res.json({ success: true, data: backups.map((b) => ({ ...b, sizeBytes: b.sizeBytes !== null ? b.sizeBytes.toString() : null })) });
  } catch (err) {
    next(err);
  }
});

const createBackupSchema = z.object({ label: z.string().max(100).optional() });

/** Runs synchronously (can take several minutes for a large knowledge base) rather than fire-and-forget — a caller triggering a manual backup wants to know it actually succeeded before, say, proceeding with a risky operation, not get a false "started" the way scan/training kickoffs do. */
deploymentRouter.post("/backups", async (req, res, next) => {
  try {
    const parsed = createBackupSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    const databaseUrl = requireDatabaseUrl();
    const installationId = await requireInstallationId(databaseUrl);
    const result = await runBackup(databaseUrl, installationId, "MANUAL", parsed.data.label ?? null);
    res.json({ success: true, data: { ...result, sizeBytes: String(result.sizeBytes) } });
  } catch (err) {
    next(err);
  }
});

deploymentRouter.post("/backups/prune", async (_req, res, next) => {
  try {
    const databaseUrl = requireDatabaseUrl();
    const installationId = await requireInstallationId(databaseUrl);
    const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? "14");
    const pruned = await pruneOldBackups(databaseUrl, installationId, retentionDays);
    res.json({ success: true, data: { pruned } });
  } catch (err) {
    next(err);
  }
});

// ── Restore Manager ──────────────────────────────────────────────────────
// Deliberately read-only here — actually performing a restore requires
// stopping/starting Docker containers and bridging volumes, which needs
// real Docker-host access this process intentionally does not have (see
// restoreService.ts's own header comment). Run deploy/scripts/restore.sh
// on the host to perform one; this only confirms what's available to
// restore *from*.

deploymentRouter.get("/restore/available", async (_req, res, next) => {
  try {
    const databaseUrl = requireDatabaseUrl();
    const installationId = await requireInstallationId(databaseUrl);
    const backups = await listBackups(databaseUrl, installationId);
    res.json({ success: true, data: backups.filter((b) => b.status === "COMPLETED").map((b) => ({ id: b.id, filePath: b.filePath, createdAt: b.createdAt, includes: b.includes })) });
  } catch (err) {
    next(err);
  }
});

// ── Plugin Management ────────────────────────────────────────────────────

deploymentRouter.get("/plugins", async (_req, res, next) => {
  try {
    const databaseUrl = requireDatabaseUrl();
    const installationId = await requireInstallationId(databaseUrl);
    res.json({ success: true, data: await listPlugins(databaseUrl, installationId) });
  } catch (err) {
    next(err);
  }
});

deploymentRouter.get("/plugins/discover", async (_req, res, next) => {
  try {
    res.json({ success: true, data: await discoverPluginDirectories() });
  } catch (err) {
    next(err);
  }
});

const installPluginSchema = z.object({ pluginDirName: z.string().min(1) });

deploymentRouter.post("/plugins/install", async (req, res, next) => {
  try {
    const parsed = installPluginSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    const databaseUrl = requireDatabaseUrl();
    const installationId = await requireInstallationId(databaseUrl);
    const plugin = await installPlugin(databaseUrl, installationId, parsed.data.pluginDirName);
    res.json({ success: true, data: plugin });
  } catch (err) {
    next(err);
  }
});

deploymentRouter.post("/plugins/:id/enable", async (req, res, next) => {
  try {
    const databaseUrl = requireDatabaseUrl();
    await enablePlugin(databaseUrl, req.params.id);
    res.json({ success: true, data: { id: req.params.id, status: "ENABLED" } });
  } catch (err) {
    next(err);
  }
});

deploymentRouter.post("/plugins/:id/disable", async (req, res, next) => {
  try {
    const databaseUrl = requireDatabaseUrl();
    await disablePlugin(databaseUrl, req.params.id);
    res.json({ success: true, data: { id: req.params.id, status: "DISABLED" } });
  } catch (err) {
    next(err);
  }
});

deploymentRouter.get("/plugins/:id/health", async (req, res, next) => {
  try {
    const databaseUrl = requireDatabaseUrl();
    res.json({ success: true, data: await checkPluginHealth(databaseUrl, req.params.id) });
  } catch (err) {
    next(err);
  }
});

deploymentRouter.delete("/plugins/:id", async (req, res, next) => {
  try {
    const databaseUrl = requireDatabaseUrl();
    await removePlugin(databaseUrl, req.params.id);
    res.json({ success: true, data: { removed: true } });
  } catch (err) {
    next(err);
  }
});

// ── License Management ───────────────────────────────────────────────────

deploymentRouter.get("/license", async (_req, res, next) => {
  try {
    const databaseUrl = requireDatabaseUrl();
    const installationId = await requireInstallationId(databaseUrl);
    const license = await getLicenseStatus(databaseUrl, installationId);
    res.json({ success: true, data: license });
  } catch (err) {
    next(err);
  }
});

const activateLicenseSchema = z.object({ licenseFileContent: z.string().min(1) });

deploymentRouter.post("/license/activate", async (req, res, next) => {
  try {
    const parsed = activateLicenseSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid request body", parsed.error.issues.map((i) => i.message).join("; "), true);
    const databaseUrl = requireDatabaseUrl();
    const installationId = await requireInstallationId(databaseUrl);
    const result = await activateLicense(databaseUrl, installationId, parsed.data.licenseFileContent);
    if (!result.ok) throw new AppError(422, "License activation failed", result.detail, false);
    res.json({ success: true, data: result.license });
  } catch (err) {
    next(err);
  }
});

deploymentRouter.post("/license/validate", async (_req, res, next) => {
  try {
    const databaseUrl = requireDatabaseUrl();
    const installationId = await requireInstallationId(databaseUrl);
    const result = await validateLicense(databaseUrl, installationId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
