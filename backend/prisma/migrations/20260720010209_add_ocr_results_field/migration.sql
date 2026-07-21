-- AlterTable
ALTER TABLE "crawled_pages" ADD COLUMN     "ocrResults" JSONB;

-- AlterTable
ALTER TABLE "knowledge_chunks" ALTER COLUMN "updatedAt" DROP DEFAULT;
