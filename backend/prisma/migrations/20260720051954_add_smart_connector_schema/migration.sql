-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('WORDPRESS', 'WOOCOMMERCE', 'SHOPIFY', 'MAGENTO', 'OPENCART', 'PRESTASHOP', 'LARAVEL', 'GENERIC_REST', 'GENERIC_GRAPHQL', 'UNIVERSAL_REST', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "ConnectorAuthMethod" AS ENUM ('API_KEY', 'BEARER_TOKEN', 'JWT', 'OAUTH2', 'BASIC_AUTH', 'SESSION', 'CUSTOM_HEADER', 'SIGNED_REQUEST', 'NONE');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('PENDING', 'CONNECTED', 'DEGRADED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ConnectorEventType" AS ENUM ('CREATED', 'UPDATED', 'AUTHENTICATED', 'API_CALL', 'ERROR', 'RETRY', 'HEALTH_CHECK', 'DISCONNECTED', 'RECOVERED');

-- CreateTable
CREATE TABLE "connectors" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "crawlJobId" TEXT,
    "name" TEXT NOT NULL,
    "connectorType" "ConnectorType" NOT NULL,
    "authMethod" "ConnectorAuthMethod" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'PENDING',
    "config" JSONB NOT NULL,
    "healthScore" DOUBLE PRECISION,
    "securityScore" DOUBLE PRECISION,
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_credentials" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "authMethod" "ConnectorAuthMethod" NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "connector_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_endpoints" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "discoveredVia" TEXT NOT NULL,
    "responseSample" JSONB,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "lastValidatedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_health_checks" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ConnectorStatus" NOT NULL,
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    "availability" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "connector_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_events" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "eventType" "ConnectorEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connectors_installationId_idx" ON "connectors"("installationId");

-- CreateIndex
CREATE INDEX "connectors_status_idx" ON "connectors"("status");

-- CreateIndex
CREATE UNIQUE INDEX "connector_credentials_connectorId_key" ON "connector_credentials"("connectorId");

-- CreateIndex
CREATE INDEX "connector_endpoints_connectorId_idx" ON "connector_endpoints"("connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "connector_endpoints_connectorId_path_key" ON "connector_endpoints"("connectorId", "path");

-- CreateIndex
CREATE INDEX "connector_health_checks_connectorId_checkedAt_idx" ON "connector_health_checks"("connectorId", "checkedAt");

-- CreateIndex
CREATE INDEX "connector_events_connectorId_createdAt_idx" ON "connector_events"("connectorId", "createdAt");

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "crawl_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_credentials" ADD CONSTRAINT "connector_credentials_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_endpoints" ADD CONSTRAINT "connector_endpoints_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_health_checks" ADD CONSTRAINT "connector_health_checks_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_events" ADD CONSTRAINT "connector_events_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
