-- CreateTable
CREATE TABLE "tech_detection_reports" (
    "id" TEXT NOT NULL,
    "crawlJobId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "websiteUrl" TEXT NOT NULL,
    "cms" JSONB NOT NULL,
    "frontendFrameworks" JSONB NOT NULL,
    "backendFrameworks" JSONB NOT NULL,
    "programmingLanguages" JSONB NOT NULL,
    "hosting" JSONB NOT NULL,
    "server" JSONB NOT NULL,
    "cdn" JSONB NOT NULL,
    "database" JSONB NOT NULL,
    "jsLibraries" JSONB NOT NULL,
    "cssFrameworks" JSONB NOT NULL,
    "seoTools" JSONB NOT NULL,
    "analytics" JSONB NOT NULL,
    "paymentGateways" JSONB NOT NULL,
    "authentication" JSONB NOT NULL,
    "liveChat" JSONB NOT NULL,
    "forms" JSONB NOT NULL,
    "securityFindings" JSONB NOT NULL,
    "securityScore" DOUBLE PRECISION NOT NULL,
    "performanceFindings" JSONB NOT NULL,
    "performanceScore" DOUBLE PRECISION NOT NULL,
    "overallConfidence" DOUBLE PRECISION NOT NULL,
    "recommendations" JSONB NOT NULL,
    "smartConnectorCompatibility" JSONB NOT NULL,

    CONSTRAINT "tech_detection_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tech_detection_reports_crawlJobId_key" ON "tech_detection_reports"("crawlJobId");

-- AddForeignKey
ALTER TABLE "tech_detection_reports" ADD CONSTRAINT "tech_detection_reports_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "crawl_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
