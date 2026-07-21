// The monitor domain's only Prisma-touching file, matching every other
// domain's "exactly one xxxRecord.service.ts" convention — engines under
// monitor/detect, monitor/compare, monitor/schedule, monitor/jobs, and
// monitor/notify stay pure (no Prisma, no network) and hand their output
// here to persist.

import { PrismaClient, Prisma, type JobType, type JobStatus, type NotificationType, type NotificationSeverity, type NotificationChannelType, type NotificationDeliveryStatus } from "@prisma/client";
import type { ProductSnapshot, ServiceSnapshot, FaqSnapshot, PolicySnapshot, ContactSnapshot } from "./detect/entityChangeDetector";
import type { NotificationSettingsInput } from "./notify/notificationEngine";
import type { KnowledgeComparisonReportData } from "./compare/comparisonReportBuilder";

/** Same reasoning as scanRecord.service.ts's own `toJson` — Prisma's Json input type demands a structural index signature our precise domain interfaces intentionally don't have (see entityChangeDetector.ts's own identical note on the same TS quirk), even though they're already valid JSON at runtime. `<T>` accepts any JSON-shaped value, not just Record/array. */
function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function readJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export class MonitorRecordService {
  private prisma: PrismaClient;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getInstallationWebsiteUrl(installationId: string): Promise<string | null> {
    const installation = await this.prisma.installation.findUnique({ where: { id: installationId }, select: { websiteUrl: true } });
    return installation?.websiteUrl ?? null;
  }

  async getCrawlJobMeta(crawlJobId: string): Promise<{ installationId: string; websiteUrl: string }> {
    const job = await this.prisma.crawlJob.findUniqueOrThrow({ where: { id: crawlJobId }, select: { installationId: true, websiteUrl: true } });
    return job;
  }

  async getPageHashesForCrawlJob(crawlJobId: string): Promise<{ url: string; contentHash: string | null }[]> {
    return this.prisma.crawledPage.findMany({ where: { crawlJobId }, select: { url: true, contentHash: true } });
  }

  /** The website URL + scan options a ScanSchedule's referenced crawl job used — replayed verbatim for each scheduled recrawl, so "schedule this scan to repeat" means exactly that rather than an administrator having to re-specify options. */
  async getCrawlJobConfig(crawlJobId: string): Promise<{ websiteUrl: string; config: { maxDepth?: number; maxPages?: number; concurrency?: number } }> {
    const job = await this.prisma.crawlJob.findUniqueOrThrow({ where: { id: crawlJobId }, select: { websiteUrl: true, config: true } });
    return { websiteUrl: job.websiteUrl, config: (job.config as { maxDepth?: number; maxPages?: number; concurrency?: number } | null) ?? {} };
  }

  /** Created with status RUNNING and startedAt set immediately — this record service has no in-process queue backing it (see monitor/jobs/jobQueue.ts's own doc comment on that being a deliberate, separate concern); a webhook-triggered scan starts executing the moment it's accepted, so there's no PENDING wait to represent. */
  async createBackgroundJob(installationId: string, type: JobType, payload: Record<string, unknown>): Promise<string> {
    const job = await this.prisma.backgroundJob.create({
      data: { installationId, type, payload: toJson(payload), status: "RUNNING", attempts: 1, startedAt: new Date() },
    });
    return job.id;
  }

  async completeBackgroundJob(jobId: string): Promise<void> {
    await this.prisma.backgroundJob.update({ where: { id: jobId }, data: { status: "COMPLETED", completedAt: new Date() } });
  }

  async failBackgroundJob(jobId: string, errorMessage: string): Promise<void> {
    await this.prisma.backgroundJob.update({ where: { id: jobId }, data: { status: "FAILED", completedAt: new Date(), lastError: errorMessage } });
  }

  async getBackgroundJob(jobId: string): Promise<{ id: string; status: JobStatus; lastError: string | null; completedAt: Date | null } | null> {
    return this.prisma.backgroundJob.findUnique({ where: { id: jobId }, select: { id: true, status: true, lastError: true, completedAt: true } });
  }

  async listBackgroundJobs(installationId: string, limit = 50): Promise<
    { id: string; type: JobType; status: JobStatus; payload: unknown; lastError: string | null; startedAt: Date | null; completedAt: Date | null; createdAt: Date }[]
  > {
    return this.prisma.backgroundJob.findMany({
      where: { installationId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, type: true, status: true, payload: true, lastError: true, startedAt: true, completedAt: true, createdAt: true },
    });
  }

  // ── Entity snapshots (Knowledge Comparison Engine inputs) ──────────────
  // Every one of these scopes strictly to one crawl job's own extracted
  // rows — see entityChangeDetector.ts's own doc comment on why a fresh
  // crawl job always gets fresh rows rather than updating prior ones in
  // place, which is exactly what makes this scoping meaningful (comparing
  // crawl job A's rows against crawl job B's rows is a real "what changed
  // between these two runs" diff, not an artifact of shared storage).

  async getProductSnapshotsForCrawlJob(crawlJobId: string): Promise<ProductSnapshot[]> {
    const rows = await this.prisma.extractedProduct.findMany({
      where: { page: { crawlJobId } },
      select: { name: true, sku: true, price: true, currency: true, discount: true, stockStatus: true, description: true },
    });
    return rows;
  }

  async getServiceSnapshotsForCrawlJob(crawlJobId: string): Promise<ServiceSnapshot[]> {
    const rows = await this.prisma.extractedService.findMany({ where: { page: { crawlJobId } }, select: { name: true, pricing: true, description: true } });
    return rows;
  }

  async getFaqSnapshotsForCrawlJob(crawlJobId: string): Promise<FaqSnapshot[]> {
    const rows = await this.prisma.extractedFaq.findMany({ where: { page: { crawlJobId } }, select: { question: true, answer: true } });
    return rows;
  }

  async getPolicySnapshotsForCrawlJob(crawlJobId: string): Promise<PolicySnapshot[]> {
    const rows = await this.prisma.extractedPolicy.findMany({ where: { page: { crawlJobId } }, select: { policyType: true, title: true, content: true } });
    return rows;
  }

  async getContactSnapshotsForCrawlJob(crawlJobId: string): Promise<ContactSnapshot[]> {
    const rows = await this.prisma.extractedContact.findMany({
      where: { page: { crawlJobId } },
      select: { contactType: true, branch: true, phones: true, emails: true, addresses: true },
    });
    return rows.map((r) => ({
      contactType: r.contactType,
      branch: r.branch,
      phones: readJsonArray<string>(r.phones),
      emails: readJsonArray<string>(r.emails),
      addresses: readJsonArray<string>(r.addresses),
    }));
  }

  // ── Site metadata snapshots (sitemap/robots.txt/technology) ────────────

  async getCrawlJobMetadataSnapshot(crawlJobId: string): Promise<{ sitemapUrls: string[]; robotsTxtContent: string | null; technologies: string[] }> {
    const job = await this.prisma.crawlJob.findUniqueOrThrow({ where: { id: crawlJobId }, select: { sitemapUrls: true, robotsTxtContent: true, techStack: true } });
    const techStack = job.techStack as { cms?: string | null; server?: string | null; ecommerce?: string | null; frameworks?: string[] } | null;
    const technologies = techStack ? [techStack.cms, techStack.server, techStack.ecommerce, ...(techStack.frameworks ?? [])].filter((t): t is string => !!t) : [];
    return { sitemapUrls: readJsonArray<string>(job.sitemapUrls), robotsTxtContent: job.robotsTxtContent, technologies };
  }

  async getPreviousCompletedCrawlJobId(installationId: string, websiteUrl: string, excludeCrawlJobId: string): Promise<string | null> {
    const previous = await this.prisma.crawlJob.findFirst({
      where: { installationId, websiteUrl, status: "COMPLETED", id: { not: excludeCrawlJobId } },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    return previous?.id ?? null;
  }

  // ── Knowledge Comparison Engine persistence ─────────────────────────────

  async saveComparisonReport(report: KnowledgeComparisonReportData): Promise<void> {
    await this.prisma.knowledgeComparisonReport.upsert({
      where: { crawlJobId: report.crawlJobId },
      create: {
        crawlJobId: report.crawlJobId,
        previousCrawlJobId: report.previousCrawlJobId,
        pagesAdded: report.pagesAdded,
        pagesRemoved: report.pagesRemoved,
        pagesUpdated: report.pagesUpdated,
        pagesUnchanged: report.pagesUnchanged,
        chunksAdded: report.chunksAdded,
        chunksRemoved: report.chunksRemoved,
        chunksUpdated: report.chunksUpdated,
        chunksDuplicate: report.chunksDuplicate,
        entityChanges: toJson(report.entityChanges),
        metadataChanges: toJson(report.metadataChanges),
        categoryBreakdown: toJson(report.categoryBreakdown),
      },
      // A rerun of training for the same crawl job (e.g. after fixing an
      // error) regenerates rather than duplicates its comparison report —
      // crawlJobId is @unique specifically to make this idempotent.
      update: {
        pagesAdded: report.pagesAdded,
        pagesRemoved: report.pagesRemoved,
        pagesUpdated: report.pagesUpdated,
        pagesUnchanged: report.pagesUnchanged,
        chunksAdded: report.chunksAdded,
        chunksRemoved: report.chunksRemoved,
        chunksUpdated: report.chunksUpdated,
        chunksDuplicate: report.chunksDuplicate,
        entityChanges: toJson(report.entityChanges),
        metadataChanges: toJson(report.metadataChanges),
        categoryBreakdown: toJson(report.categoryBreakdown),
      },
    });
  }

  async getComparisonReport(crawlJobId: string): Promise<KnowledgeComparisonReportData | null> {
    const row = await this.prisma.knowledgeComparisonReport.findUnique({ where: { crawlJobId } });
    if (!row) return null;
    return {
      crawlJobId: row.crawlJobId,
      previousCrawlJobId: row.previousCrawlJobId,
      pagesAdded: row.pagesAdded,
      pagesRemoved: row.pagesRemoved,
      pagesUpdated: row.pagesUpdated,
      pagesUnchanged: row.pagesUnchanged,
      chunksAdded: row.chunksAdded,
      chunksRemoved: row.chunksRemoved,
      chunksUpdated: row.chunksUpdated,
      chunksDuplicate: row.chunksDuplicate,
      entityChanges: row.entityChanges as unknown as KnowledgeComparisonReportData["entityChanges"],
      metadataChanges: row.metadataChanges as unknown as KnowledgeComparisonReportData["metadataChanges"],
      categoryBreakdown: row.categoryBreakdown as unknown as KnowledgeComparisonReportData["categoryBreakdown"],
      generatedAt: row.generatedAt.toISOString(),
    };
  }

  async listComparisonReports(installationId: string, limit = 20): Promise<{ crawlJobId: string; previousCrawlJobId: string | null; generatedAt: Date }[]> {
    return this.prisma.knowledgeComparisonReport.findMany({
      where: { crawlJob: { installationId } },
      orderBy: { generatedAt: "desc" },
      take: limit,
      select: { crawlJobId: true, previousCrawlJobId: true, generatedAt: true },
    });
  }

  // ── Notification Engine persistence ─────────────────────────────────────

  async getNotificationSettings(installationId: string): Promise<NotificationSettingsInput | null> {
    const row = await this.prisma.notificationSettings.findUnique({ where: { installationId } });
    if (!row) return null;
    return {
      emailEnabled: row.emailEnabled,
      emailAddress: row.emailAddress,
      webhookEnabled: row.webhookEnabled,
      webhookUrl: row.webhookUrl,
      enabledEmailTypes: readJsonArray<string>(row.enabledEmailTypes),
      enabledWebhookTypes: readJsonArray<string>(row.enabledWebhookTypes),
    };
  }

  async upsertNotificationSettings(
    installationId: string,
    settings: Partial<{ emailEnabled: boolean; emailAddress: string | null; webhookEnabled: boolean; webhookUrl: string | null; enabledEmailTypes: string[]; enabledWebhookTypes: string[] }>
  ): Promise<void> {
    const data = {
      emailEnabled: settings.emailEnabled,
      emailAddress: settings.emailAddress,
      webhookEnabled: settings.webhookEnabled,
      webhookUrl: settings.webhookUrl,
      enabledEmailTypes: settings.enabledEmailTypes ? toJson(settings.enabledEmailTypes) : undefined,
      enabledWebhookTypes: settings.enabledWebhookTypes ? toJson(settings.enabledWebhookTypes) : undefined,
    };
    await this.prisma.notificationSettings.upsert({
      where: { installationId },
      create: { installationId, ...data },
      update: data,
    });
  }

  async createNotification(installationId: string, type: NotificationType, severity: NotificationSeverity, title: string, message: string, metadata?: Record<string, unknown>): Promise<string> {
    const notification = await this.prisma.notification.create({
      data: { installationId, type, severity, title, message, metadata: metadata ? toJson(metadata) : undefined },
    });
    return notification.id;
  }

  async recordNotificationDelivery(notificationId: string, channel: NotificationChannelType, status: NotificationDeliveryStatus, errorMessage?: string): Promise<void> {
    await this.prisma.notificationDelivery.create({ data: { notificationId, channel, status, errorMessage } });
  }

  async listNotifications(installationId: string, limit = 50): Promise<
    { id: string; type: NotificationType; severity: NotificationSeverity; title: string; message: string; readAt: Date | null; createdAt: Date }[]
  > {
    return this.prisma.notification.findMany({
      where: { installationId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, type: true, severity: true, title: true, message: true, readAt: true, createdAt: true },
    });
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    await this.prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  }

  // ── Scheduled Recrawling (ScanSchedule) ─────────────────────────────────

  async createScanSchedule(installationId: string, crawlJobId: string, cronExpression: string, label: string | null): Promise<string> {
    const schedule = await this.prisma.scanSchedule.create({ data: { installationId, crawlJobId, cronExpression, label, enabled: true } });
    return schedule.id;
  }

  async listScanSchedules(installationId: string): Promise<
    { id: string; crawlJobId: string; cronExpression: string; label: string | null; enabled: boolean; lastRunAt: Date | null; nextRunAt: Date | null }[]
  > {
    return this.prisma.scanSchedule.findMany({
      where: { installationId },
      orderBy: { createdAt: "desc" },
      select: { id: true, crawlJobId: true, cronExpression: true, label: true, enabled: true, lastRunAt: true, nextRunAt: true },
    });
  }

  /** Every enabled schedule across every installation — read once at process boot to re-register each with the in-process CronRuntime (see index.ts), since the runtime scheduler itself doesn't survive a restart even though this table does. */
  async listAllEnabledScanSchedules(): Promise<{ id: string; installationId: string; crawlJobId: string; cronExpression: string }[]> {
    return this.prisma.scanSchedule.findMany({ where: { enabled: true }, select: { id: true, installationId: true, crawlJobId: true, cronExpression: true } });
  }

  async updateScanScheduleEnabled(scheduleId: string, enabled: boolean): Promise<void> {
    await this.prisma.scanSchedule.update({ where: { id: scheduleId }, data: { enabled } });
  }

  async deleteScanSchedule(scheduleId: string): Promise<void> {
    await this.prisma.scanSchedule.delete({ where: { id: scheduleId } });
  }

  async recordScanScheduleRun(scheduleId: string, nextRunAt: Date | null): Promise<void> {
    await this.prisma.scanSchedule.update({ where: { id: scheduleId }, data: { lastRunAt: new Date(), nextRunAt } });
  }

  async getScanSchedule(scheduleId: string): Promise<{ id: string; installationId: string; crawlJobId: string } | null> {
    return this.prisma.scanSchedule.findUnique({ where: { id: scheduleId }, select: { id: true, installationId: true, crawlJobId: true } });
  }
}
