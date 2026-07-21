-- CreateEnum
CREATE TYPE "CrawlJobStatus" AS ENUM ('QUEUED', 'DISCOVERING', 'CRAWLING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PageCrawlStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PDF', 'DOCX', 'DOC', 'XLSX', 'CSV', 'TXT', 'MARKDOWN', 'XML', 'JSON');

-- CreateTable
CREATE TABLE "crawl_jobs" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "status" "CrawlJobStatus" NOT NULL DEFAULT 'QUEUED',
    "config" JSONB NOT NULL,
    "techStack" JSONB,
    "totalPagesDiscovered" INTEGER NOT NULL DEFAULT 0,
    "totalPagesCrawled" INTEGER NOT NULL DEFAULT 0,
    "totalPagesFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "crawl_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawled_pages" (
    "id" TEXT NOT NULL,
    "crawlJobId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "depth" INTEGER NOT NULL,
    "statusCode" INTEGER,
    "contentHash" TEXT,
    "pageType" TEXT,
    "crawlStatus" "PageCrawlStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "title" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "language" TEXT,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfUrl" TEXT,
    "headings" JSONB,
    "paragraphs" JSONB,
    "lists" JSONB,
    "tables" JSONB,
    "breadcrumbs" JSONB,
    "contactInfo" JSONB,
    "images" JSONB,
    "videos" JSONB,
    "forms" JSONB,
    "ctaButtons" JSONB,
    "structuredData" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crawled_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_products" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "price" TEXT,
    "currency" TEXT,
    "discount" TEXT,
    "description" TEXT,
    "specifications" JSONB,
    "features" JSONB,
    "images" JSONB,
    "sku" TEXT,
    "brand" TEXT,
    "stockStatus" TEXT,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'structured_data',

    CONSTRAINT "extracted_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_services" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricing" TEXT,
    "benefits" JSONB,
    "features" JSONB,
    "workflow" JSONB,
    "industries" JSONB,
    "source" TEXT NOT NULL DEFAULT 'heuristic',

    CONSTRAINT "extracted_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_faqs" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'heuristic',

    CONSTRAINT "extracted_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_documents" (
    "id" TEXT NOT NULL,
    "crawlJobId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "extractedText" TEXT,
    "contentHash" TEXT,
    "pageCount" INTEGER,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "crawlJobId" TEXT NOT NULL,
    "pageId" TEXT,
    "documentId" TEXT,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "embedding" DOUBLE PRECISION[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_reports" (
    "id" TEXT NOT NULL,
    "crawlJobId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "techStack" JSONB NOT NULL,
    "totalPages" INTEGER NOT NULL,
    "scannedPages" INTEGER NOT NULL,
    "failedPages" INTEGER NOT NULL,
    "productsFound" INTEGER NOT NULL,
    "servicesFound" INTEGER NOT NULL,
    "blogsFound" INTEGER NOT NULL,
    "documentsFound" INTEGER NOT NULL,
    "imagesFound" INTEGER NOT NULL,
    "faqsFound" INTEGER NOT NULL,
    "formsFound" INTEGER NOT NULL,
    "languages" JSONB NOT NULL,
    "seoSummary" JSONB NOT NULL,
    "performanceSummary" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "securityObservations" JSONB NOT NULL,

    CONSTRAINT "crawl_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crawl_jobs_installationId_idx" ON "crawl_jobs"("installationId");

-- CreateIndex
CREATE INDEX "crawl_jobs_status_idx" ON "crawl_jobs"("status");

-- CreateIndex
CREATE INDEX "crawled_pages_crawlJobId_idx" ON "crawled_pages"("crawlJobId");

-- CreateIndex
CREATE INDEX "crawled_pages_contentHash_idx" ON "crawled_pages"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "crawled_pages_crawlJobId_url_key" ON "crawled_pages"("crawlJobId", "url");

-- CreateIndex
CREATE INDEX "extracted_products_pageId_idx" ON "extracted_products"("pageId");

-- CreateIndex
CREATE INDEX "extracted_services_pageId_idx" ON "extracted_services"("pageId");

-- CreateIndex
CREATE INDEX "extracted_faqs_pageId_idx" ON "extracted_faqs"("pageId");

-- CreateIndex
CREATE INDEX "processed_documents_crawlJobId_idx" ON "processed_documents"("crawlJobId");

-- CreateIndex
CREATE INDEX "processed_documents_contentHash_idx" ON "processed_documents"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "processed_documents_crawlJobId_sourceUrl_key" ON "processed_documents"("crawlJobId", "sourceUrl");

-- CreateIndex
CREATE INDEX "knowledge_chunks_crawlJobId_idx" ON "knowledge_chunks"("crawlJobId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_pageId_idx" ON "knowledge_chunks"("pageId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_documentId_idx" ON "knowledge_chunks"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "crawl_reports_crawlJobId_key" ON "crawl_reports"("crawlJobId");

-- AddForeignKey
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawled_pages" ADD CONSTRAINT "crawled_pages_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "crawl_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_products" ADD CONSTRAINT "extracted_products_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "crawled_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_services" ADD CONSTRAINT "extracted_services_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "crawled_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_faqs" ADD CONSTRAINT "extracted_faqs_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "crawled_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_documents" ADD CONSTRAINT "processed_documents_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "crawl_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "crawl_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "crawled_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "processed_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_reports" ADD CONSTRAINT "crawl_reports_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "crawl_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
