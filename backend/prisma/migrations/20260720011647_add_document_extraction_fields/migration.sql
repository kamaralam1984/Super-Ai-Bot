-- AlterTable
ALTER TABLE "processed_documents" ADD COLUMN     "docMetadata" JSONB,
ADD COLUMN     "headings" JSONB,
ADD COLUMN     "hyperlinks" JSONB,
ADD COLUMN     "tables" JSONB;
