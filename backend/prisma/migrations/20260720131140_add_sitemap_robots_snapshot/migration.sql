-- AlterTable
ALTER TABLE "crawl_jobs" ADD COLUMN     "robotsTxtContent" TEXT,
ADD COLUMN     "sitemapUrls" JSONB;

