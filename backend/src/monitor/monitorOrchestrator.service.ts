// Phase 10 top-level composition: wires the pure engines under monitor/*
// together with MonitorRecordService (Prisma) into two real operations —
// generating+persisting a Knowledge Comparison Report for a training run,
// and deriving+delivering the notifications that report implies. Mirrors
// trainingOrchestrator.service.ts's own "compose already-built, already-
// tested pure engines; this file is the only place that touches Prisma
// composition across more than one of them" role for this phase.

import { planIncrementalRecrawl, summarizePlan, type CurrentPageRecord, type PreviousPageRecord } from "../scanner/recrawl/changeDetector";
import { detectProductChanges, detectServiceChanges, detectFaqChanges, detectPolicyChanges, detectContactChanges } from "./detect/entityChangeDetector";
import { detectSitemapChanges, detectRobotsTxtChange, detectTechnologyChanges } from "./detect/siteMetadataMonitor";
import { buildComparisonReport, summarizeComparisonHighlights, type KnowledgeComparisonReportData } from "./compare/comparisonReportBuilder";
import { determineChannels, deriveTrainingNotifications, type MonitorNotificationType } from "./notify/notificationEngine";
import { sendNotificationEmail, loadEmailConfigFromEnv } from "./notify/emailChannel";
import { deliverWebhookNotification } from "./notify/webhookChannel";
import { CronRuntime } from "./schedule/cronScheduler";
import { MonitorRecordService } from "./monitorRecord.service";
import { runWebsiteScan } from "../scanner/scanOrchestrator.service";
import { runAiTraining, type TrainingChunkStats } from "../training/trainingOrchestrator.service";
import { logEvent } from "../utils/logger";
import { formatError } from "../utils/formatError";

const EMPTY_METADATA_SNAPSHOT = { sitemapUrls: [] as string[], robotsTxtContent: null as string | null, technologies: [] as string[] };

/**
 * Builds and persists the Knowledge Comparison Report for one training
 * run. Diffs this crawl job's entity/page/metadata snapshots against the
 * previous completed crawl job for the same installation+website — the
 * very first run for an installation has no previous job to diff against,
 * so every entity/page is reported as "added" and metadata changes are
 * all `false` (nothing to compare yet), which is the honest, correct
 * answer for a baseline run, not a special case to work around.
 */
export async function generateComparisonReport(databaseUrl: string, crawlJobId: string, chunkStats: TrainingChunkStats): Promise<KnowledgeComparisonReportData> {
  const records = new MonitorRecordService(databaseUrl);
  try {
    const { installationId, websiteUrl } = await records.getCrawlJobMeta(crawlJobId);
    const previousCrawlJobId = await records.getPreviousCompletedCrawlJobId(installationId, websiteUrl, crawlJobId);

    const [currentPages, previousPages] = await Promise.all([
      records.getPageHashesForCrawlJob(crawlJobId),
      previousCrawlJobId ? records.getPageHashesForCrawlJob(previousCrawlJobId) : Promise.resolve([]),
    ]);
    const currentPageRecords: CurrentPageRecord[] = currentPages.filter((p): p is { url: string; contentHash: string } => p.contentHash !== null);
    const previousPageRecords: PreviousPageRecord[] = previousPages;
    const recrawlPlan = planIncrementalRecrawl(previousPageRecords, currentPageRecords);
    const pageChanges = summarizePlan(recrawlPlan, previousPageRecords.length, currentPageRecords.length);

    const [currentProducts, currentServices, currentFaqs, currentPolicies, currentContacts] = await Promise.all([
      records.getProductSnapshotsForCrawlJob(crawlJobId),
      records.getServiceSnapshotsForCrawlJob(crawlJobId),
      records.getFaqSnapshotsForCrawlJob(crawlJobId),
      records.getPolicySnapshotsForCrawlJob(crawlJobId),
      records.getContactSnapshotsForCrawlJob(crawlJobId),
    ]);
    const [previousProducts, previousServices, previousFaqs, previousPolicies, previousContacts] = previousCrawlJobId
      ? await Promise.all([
          records.getProductSnapshotsForCrawlJob(previousCrawlJobId),
          records.getServiceSnapshotsForCrawlJob(previousCrawlJobId),
          records.getFaqSnapshotsForCrawlJob(previousCrawlJobId),
          records.getPolicySnapshotsForCrawlJob(previousCrawlJobId),
          records.getContactSnapshotsForCrawlJob(previousCrawlJobId),
        ])
      : [[], [], [], [], []];

    const entityChanges = [
      detectProductChanges(previousProducts, currentProducts),
      detectServiceChanges(previousServices, currentServices),
      detectFaqChanges(previousFaqs, currentFaqs),
      detectPolicyChanges(previousPolicies, currentPolicies),
      detectContactChanges(previousContacts, currentContacts),
    ];

    const [currentMetadata, previousMetadata] = await Promise.all([
      records.getCrawlJobMetadataSnapshot(crawlJobId),
      previousCrawlJobId ? records.getCrawlJobMetadataSnapshot(previousCrawlJobId) : Promise.resolve(EMPTY_METADATA_SNAPSHOT),
    ]);
    const sitemapChange = detectSitemapChanges(previousMetadata.sitemapUrls, currentMetadata.sitemapUrls);
    const robotsTxtChange = detectRobotsTxtChange(previousMetadata.robotsTxtContent, currentMetadata.robotsTxtContent);
    const technologyChange = detectTechnologyChanges(previousMetadata.technologies, currentMetadata.technologies);

    const report = buildComparisonReport({
      crawlJobId,
      previousCrawlJobId,
      pageChanges,
      chunkChanges: chunkStats,
      entityChanges,
      sitemapChange,
      robotsTxtChange,
      technologyChange,
    });

    await records.saveComparisonReport(report);
    return report;
  } finally {
    await records.close();
  }
}

/**
 * Derives every notification event this report implies and delivers each
 * to whichever channels the installation has configured (Dashboard/Log
 * always; Email/Webhook opt-in — see notificationEngine.ts's
 * determineChannels). One failed channel never blocks the others or the
 * Notification row itself — the row (Dashboard's own data source) is
 * always written first, then each channel is attempted independently.
 */
export async function deliverTrainingNotifications(databaseUrl: string, installationId: string, report: KnowledgeComparisonReportData): Promise<void> {
  const records = new MonitorRecordService(databaseUrl);
  try {
    const highlights = summarizeComparisonHighlights(report);
    const events = deriveTrainingNotifications(report, highlights);
    const settings = await records.getNotificationSettings(installationId);
    const emailConfig = loadEmailConfigFromEnv();
    const webhookSecret = process.env.WEBHOOK_SECRET;

    for (const event of events) {
      const notificationId = await records.createNotification(installationId, event.type as MonitorNotificationType, event.severity, event.title, event.message);
      const channels = determineChannels(event.type, settings);

      for (const channel of channels) {
        if (channel === "DASHBOARD") continue; // the Notification row itself IS the dashboard's data — no separate delivery to record

        if (channel === "LOG") {
          logEvent({ component: "monitor-notification", message: `[${event.type}] ${event.title}: ${event.message}`, status: "info" });
          await records.recordNotificationDelivery(notificationId, "LOG", "SENT");
          continue;
        }

        if (channel === "EMAIL") {
          if (!emailConfig || !settings?.emailAddress) {
            await records.recordNotificationDelivery(notificationId, "EMAIL", "SKIPPED", "SMTP not configured or no recipient address set");
            continue;
          }
          const result = await sendNotificationEmail(emailConfig, { to: settings.emailAddress, subject: event.title, text: event.message });
          await records.recordNotificationDelivery(notificationId, "EMAIL", result.ok ? "SENT" : "FAILED", result.errorMessage);
          continue;
        }

        if (channel === "WEBHOOK") {
          if (!webhookSecret || !settings?.webhookUrl) {
            await records.recordNotificationDelivery(notificationId, "WEBHOOK", "SKIPPED", "WEBHOOK_SECRET not configured or no webhook URL set");
            continue;
          }
          const result = await deliverWebhookNotification({
            url: settings.webhookUrl,
            secret: webhookSecret,
            payload: { type: event.type, severity: event.severity, title: event.title, message: event.message, crawlJobId: report.crawlJobId },
          });
          await records.recordNotificationDelivery(notificationId, "WEBHOOK", result.ok ? "SENT" : "FAILED", result.errorMessage);
        }
      }
    }
  } finally {
    await records.close();
  }
}

/**
 * The full post-training hook — generate the comparison report, then
 * deliver the notifications it implies. Deliberately never throws: a
 * monitoring/notification failure must never be mistaken for the training
 * run itself having failed (the run already succeeded by the time this is
 * called) — errors are logged and swallowed, matching every other
 * fire-and-forget post-processing step in this codebase (e.g.
 * scan.routes.ts's unhandled-promise logging).
 */
export async function runPostTrainingMonitoring(databaseUrl: string, crawlJobId: string, chunkStats: TrainingChunkStats): Promise<void> {
  try {
    const report = await generateComparisonReport(databaseUrl, crawlJobId, chunkStats);
    const records = new MonitorRecordService(databaseUrl);
    const { installationId } = await records.getCrawlJobMeta(crawlJobId);
    await records.close();
    await deliverTrainingNotifications(databaseUrl, installationId, report);
  } catch (err) {
    logEvent({ component: "monitor-orchestrator", message: "Post-training monitoring failed", status: "error", error: formatError(err) });
  }
}

// ── Scheduled Recrawling ───────────────────────────────────────────────
//
// One process-wide CronRuntime, same "single long-running Node process
// per self-hosted installation" model every other in-process scheduler in
// this codebase assumes (retrainScheduler.ts, cronScheduler.ts's own
// module doc comment). Routes register/unregister individual schedules
// against this shared instance as ScanSchedule rows are created/deleted;
// index.ts calls registerAllScanSchedules once at boot to restore every
// enabled schedule the database remembers from before the restart.
let scheduleRuntime: CronRuntime | null = null;

export function getScheduleRuntime(): CronRuntime {
  if (!scheduleRuntime) {
    scheduleRuntime = new CronRuntime((scheduleId) => executeScheduledScan(requireDatabaseUrlForSchedule(), scheduleId));
  }
  return scheduleRuntime;
}

// The CronRuntime singleton is constructed once, lazily, without a
// databaseUrl in scope (module load time, before any request) — this
// resolves it fresh on every fire instead of capturing a stale/absent
// value, matching how every route handler in this codebase reads
// process.env.DATABASE_URL per-request rather than once at startup.
function requireDatabaseUrlForSchedule(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured — cannot execute a scheduled scan");
  return databaseUrl;
}

/**
 * One scheduled recrawl firing: repeats the referenced crawl job's
 * website+options through the same runWebsiteScan → runAiTraining chain a
 * manual "start scan" + "start training" pair would, then runs the same
 * post-training monitoring hook (comparison report + notifications) a
 * manual run gets. A schedule firing is functionally "do exactly what an
 * administrator would do by hand," just on a timer.
 */
export async function executeScheduledScan(databaseUrl: string, scheduleId: string): Promise<void> {
  const records = new MonitorRecordService(databaseUrl);
  try {
    const schedule = await records.getScanSchedule(scheduleId);
    if (!schedule) {
      logEvent({ component: "monitor-orchestrator", message: `Scheduled scan fired for unknown scheduleId=${scheduleId} — schedule was deleted without unregistering`, status: "warn" });
      return;
    }
    const { websiteUrl, config } = await records.getCrawlJobConfig(schedule.crawlJobId);
    await records.close();

    const scanResult = await runWebsiteScan(databaseUrl, schedule.installationId, websiteUrl, config, () => {});
    if (!scanResult.success) {
      logEvent({ component: "monitor-orchestrator", message: `Scheduled scan failed for scheduleId=${scheduleId}`, status: "error", error: scanResult.errorMessage ?? undefined });
      return;
    }

    const trainingResult = await runAiTraining(databaseUrl, scanResult.crawlJobId, () => {});
    if (trainingResult.success && trainingResult.chunkStats) {
      await runPostTrainingMonitoring(databaseUrl, scanResult.crawlJobId, trainingResult.chunkStats);
    }

    const recordsAfter = new MonitorRecordService(databaseUrl);
    try {
      await recordsAfter.recordScanScheduleRun(scheduleId, null); // CronRuntime re-arms its own next fire internally; nextRunAt here is purely informational for the API/UI
    } finally {
      await recordsAfter.close();
    }
  } catch (err) {
    logEvent({ component: "monitor-orchestrator", message: `Scheduled scan threw for scheduleId=${scheduleId}`, status: "error", error: formatError(err) });
  }
}

/** Called once at process boot (index.ts) — restores every enabled ScanSchedule from the database into the in-process CronRuntime, since the runtime itself starts empty on every restart even though the schedule definitions persisted. */
export async function registerAllScanSchedules(databaseUrl: string): Promise<number> {
  const records = new MonitorRecordService(databaseUrl);
  try {
    const schedules = await records.listAllEnabledScanSchedules();
    const runtime = getScheduleRuntime();
    for (const schedule of schedules) {
      runtime.register(schedule.id, schedule.cronExpression);
    }
    if (schedules.length > 0) {
      logEvent({ component: "monitor-orchestrator", message: `Restored ${schedules.length} scheduled scan(s) into the in-process cron runtime`, status: "info" });
    }
    return schedules.length;
  } finally {
    await records.close();
  }
}
