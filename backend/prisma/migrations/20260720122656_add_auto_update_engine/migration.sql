-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WEBSITE_UPDATED', 'TRAINING_COMPLETED', 'KNOWLEDGE_UPDATED', 'ERROR_OCCURRED', 'CONNECTION_FAILED', 'NEW_PRODUCTS_FOUND', 'NEW_SERVICES_FOUND', 'API_CHANGED', 'TECHNOLOGY_CHANGED', 'JOB_FAILED', 'ROLLBACK_PERFORMED');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'SUCCESS');

-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('DASHBOARD', 'EMAIL', 'WEBHOOK', 'LOG');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('SCAN', 'TRAINING', 'NOTIFICATION_DELIVERY', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "NotificationChannelType" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorMessage" TEXT,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailAddress" TEXT,
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookUrl" TEXT,
    "enabledEmailTypes" JSONB NOT NULL DEFAULT '[]',
    "enabledWebhookTypes" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_schedules" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "crawlJobId" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_comparison_reports" (
    "id" TEXT NOT NULL,
    "crawlJobId" TEXT NOT NULL,
    "previousCrawlJobId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pagesAdded" INTEGER NOT NULL,
    "pagesRemoved" INTEGER NOT NULL,
    "pagesUpdated" INTEGER NOT NULL,
    "pagesUnchanged" INTEGER NOT NULL,
    "chunksAdded" INTEGER NOT NULL,
    "chunksRemoved" INTEGER NOT NULL,
    "chunksUpdated" INTEGER NOT NULL,
    "chunksDuplicate" INTEGER NOT NULL,
    "entityChanges" JSONB NOT NULL,
    "metadataChanges" JSONB NOT NULL,
    "categoryBreakdown" JSONB NOT NULL,

    CONSTRAINT "knowledge_comparison_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_installationId_createdAt_idx" ON "notifications"("installationId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_installationId_readAt_idx" ON "notifications"("installationId", "readAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_notificationId_idx" ON "notification_deliveries"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_installationId_key" ON "notification_settings"("installationId");

-- CreateIndex
CREATE INDEX "background_jobs_installationId_status_idx" ON "background_jobs"("installationId", "status");

-- CreateIndex
CREATE INDEX "background_jobs_status_scheduledFor_idx" ON "background_jobs"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "scan_schedules_installationId_idx" ON "scan_schedules"("installationId");

-- CreateIndex
CREATE INDEX "scan_schedules_enabled_nextRunAt_idx" ON "scan_schedules"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_comparison_reports_crawlJobId_key" ON "knowledge_comparison_reports"("crawlJobId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_schedules" ADD CONSTRAINT "scan_schedules_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_comparison_reports" ADD CONSTRAINT "knowledge_comparison_reports_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "crawl_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

