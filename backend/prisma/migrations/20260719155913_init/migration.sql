-- CreateEnum
CREATE TYPE "InstallationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "LogStatus" AS ENUM ('INFO', 'SUCCESS', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "installations" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "websiteName" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "status" "InstallationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secret_fingerprints" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "secretName" TEXT NOT NULL,
    "fingerprintHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secret_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation_logs" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "status" "LogStatus" NOT NULL,
    "component" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "installations_applicationId_key" ON "installations"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "installations_installationId_key" ON "installations"("installationId");

-- CreateIndex
CREATE INDEX "installations_status_idx" ON "installations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "secret_fingerprints_installationId_secretName_key" ON "secret_fingerprints"("installationId", "secretName");

-- CreateIndex
CREATE INDEX "installation_logs_installationId_time_idx" ON "installation_logs"("installationId", "time");

-- AddForeignKey
ALTER TABLE "secret_fingerprints" ADD CONSTRAINT "secret_fingerprints_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installation_logs" ADD CONSTRAINT "installation_logs_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
