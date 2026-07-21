-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('GENERAL', 'SUPPORT', 'SALES');

-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('PRIVACY', 'REFUND', 'SHIPPING', 'CANCELLATION', 'WARRANTY', 'TERMS', 'COOKIES', 'OTHER');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('PRODUCT_CATEGORY', 'SERVICE_INDUSTRY', 'FAQ_PRODUCT', 'FAQ_SERVICE', 'POLICY_SERVICE', 'BLOG_PRODUCT', 'COMPANY_CONTACT', 'PRODUCT_PRODUCT', 'SERVICE_SERVICE');

-- AlterTable
ALTER TABLE "extracted_faqs" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "mergedFaqIds" JSONB,
ADD COLUMN     "relatedQuestions" JSONB,
ADD COLUMN     "similarQuestions" JSONB;

-- AlterTable
ALTER TABLE "extracted_products" ADD COLUMN     "availability" TEXT,
ADD COLUMN     "benefits" JSONB,
ADD COLUMN     "relatedProducts" JSONB;

-- AlterTable
ALTER TABLE "extracted_services" ADD COLUMN     "dependencies" JSONB,
ADD COLUMN     "relatedServices" JSONB;

-- CreateTable
CREATE TABLE "extracted_contacts" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "contactType" "ContactType" NOT NULL DEFAULT 'GENERAL',
    "branch" TEXT,
    "department" TEXT,
    "phones" JSONB,
    "emails" JSONB,
    "addresses" JSONB,
    "mapsLinks" JSONB,
    "hours" JSONB,
    "source" TEXT NOT NULL DEFAULT 'heuristic',

    CONSTRAINT "extracted_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_policies" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "policyType" "PolicyType" NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'heuristic',

    CONSTRAINT "extracted_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_relationships" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationshipType" "RelationshipType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_reports" (
    "id" TEXT NOT NULL,
    "crawlJobId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incremental" BOOLEAN NOT NULL DEFAULT false,
    "totalDocuments" INTEGER NOT NULL,
    "totalPages" INTEGER NOT NULL,
    "productsLearned" INTEGER NOT NULL,
    "servicesLearned" INTEGER NOT NULL,
    "faqsLearned" INTEGER NOT NULL,
    "policiesLearned" INTEGER NOT NULL,
    "contactsLearned" INTEGER NOT NULL,
    "embeddingsGenerated" INTEGER NOT NULL,
    "relationshipsCreated" INTEGER NOT NULL,
    "trainingTimeMs" INTEGER NOT NULL,
    "categoryBreakdown" JSONB NOT NULL,
    "overallConfidence" DOUBLE PRECISION NOT NULL,
    "errors" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,

    CONSTRAINT "training_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "extracted_contacts_pageId_idx" ON "extracted_contacts"("pageId");

-- CreateIndex
CREATE INDEX "extracted_policies_pageId_idx" ON "extracted_policies"("pageId");

-- CreateIndex
CREATE INDEX "knowledge_relationships_installationId_idx" ON "knowledge_relationships"("installationId");

-- CreateIndex
CREATE INDEX "knowledge_relationships_sourceType_sourceId_idx" ON "knowledge_relationships"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "knowledge_relationships_targetType_targetId_idx" ON "knowledge_relationships"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_relationships_sourceType_sourceId_targetType_targ_key" ON "knowledge_relationships"("sourceType", "sourceId", "targetType", "targetId", "relationshipType");

-- CreateIndex
CREATE UNIQUE INDEX "training_reports_crawlJobId_key" ON "training_reports"("crawlJobId");

-- AddForeignKey
ALTER TABLE "extracted_contacts" ADD CONSTRAINT "extracted_contacts_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "crawled_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_policies" ADD CONSTRAINT "extracted_policies_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "crawled_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_reports" ADD CONSTRAINT "training_reports_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "crawl_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
