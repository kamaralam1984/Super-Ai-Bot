-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('MANUAL', 'SCHEDULED', 'PRE_UPDATE');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PluginStatus" AS ENUM ('ENABLED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "LicenseTier" AS ENUM ('STANDARD', 'ENTERPRISE', 'AGENCY');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'INVALID', 'REVOKED');

-- CreateTable
CREATE TABLE "backup_records" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "label" TEXT,
    "type" "BackupType" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "filePath" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "includes" JSONB NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugins" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "entryPoint" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "manifest" JSONB NOT NULL,
    "status" "PluginStatus" NOT NULL DEFAULT 'DISABLED',
    "errorMessage" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "licenseKey" TEXT NOT NULL,
    "tier" "LicenseTier" NOT NULL,
    "machineFingerprint" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastValidatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_records_installationId_createdAt_idx" ON "backup_records"("installationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "plugins_installationId_name_key" ON "plugins"("installationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_installationId_key" ON "licenses"("installationId");

-- AddForeignKey
ALTER TABLE "backup_records" ADD CONSTRAINT "backup_records_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

