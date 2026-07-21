-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('PRODUCTS', 'SERVICES', 'FAQS', 'ORDERS', 'CUSTOMERS', 'INVENTORY', 'APPOINTMENTS', 'CATEGORIES', 'PRICING', 'SHIPPING', 'BLOGS', 'SUPPORT_ARTICLES');

-- CreateEnum
CREATE TYPE "PermissionAccessLevel" AS ENUM ('READ_ONLY');

-- CreateEnum
CREATE TYPE "PermissionGrantStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "PermissionEventType" AS ENUM ('WIZARD_STARTED', 'WIZARD_COMPLETED', 'GRANTED', 'REVOKED', 'ACCESS_CHECKED', 'ACCESS_DENIED');

-- CreateTable
CREATE TABLE "permission_grants" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "connectorId" TEXT,
    "dataScope" "DataScope" NOT NULL,
    "accessLevel" "PermissionAccessLevel" NOT NULL DEFAULT 'READ_ONLY',
    "status" "PermissionGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "notes" TEXT,

    CONSTRAINT "permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_events" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "connectorId" TEXT,
    "dataScope" "DataScope",
    "eventType" "PermissionEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "permission_grants_installationId_status_idx" ON "permission_grants"("installationId", "status");

-- CreateIndex
CREATE INDEX "permission_grants_connectorId_idx" ON "permission_grants"("connectorId");

-- CreateIndex
CREATE INDEX "permission_events_installationId_createdAt_idx" ON "permission_events"("installationId", "createdAt");

-- AddForeignKey
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_events" ADD CONSTRAINT "permission_events_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
