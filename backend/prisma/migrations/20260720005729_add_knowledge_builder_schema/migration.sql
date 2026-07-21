/*
  Warnings:

  - Added the required column `updatedAt` to the `knowledge_chunks` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ChunkType" AS ENUM ('PARAGRAPH', 'TABLE', 'CODE', 'HEADING_SECTION', 'LIST');

-- AlterTable
ALTER TABLE "extracted_faqs" ADD COLUMN     "duplicateOfFaqId" TEXT,
ADD COLUMN     "isDuplicate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "knowledge_chunks" ADD COLUMN     "chunkType" "ChunkType" NOT NULL DEFAULT 'PARAGRAPH',
ADD COLUMN     "duplicateOfChunkId" TEXT,
ADD COLUMN     "embeddingModel" TEXT NOT NULL DEFAULT 'Xenova/all-MiniLM-L6-v2',
ADD COLUMN     "embeddingVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "section" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "chunk_versions" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunk_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vector_index_meta" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "vectorCount" INTEGER NOT NULL DEFAULT 0,
    "dimensions" INTEGER NOT NULL,
    "indexFilePath" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "lastRebuiltAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vector_index_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_query_logs" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "queryLanguage" TEXT,
    "searchMode" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "topChunkIds" JSONB NOT NULL,
    "tookMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_query_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chunk_versions_chunkId_idx" ON "chunk_versions"("chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "chunk_versions_chunkId_version_key" ON "chunk_versions"("chunkId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "vector_index_meta_namespace_key" ON "vector_index_meta"("namespace");

-- CreateIndex
CREATE INDEX "search_query_logs_installationId_createdAt_idx" ON "search_query_logs"("installationId", "createdAt");

-- CreateIndex
CREATE INDEX "knowledge_chunks_category_idx" ON "knowledge_chunks"("category");

-- CreateIndex
CREATE INDEX "knowledge_chunks_isDuplicate_idx" ON "knowledge_chunks"("isDuplicate");

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_duplicateOfChunkId_fkey" FOREIGN KEY ("duplicateOfChunkId") REFERENCES "knowledge_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunk_versions" ADD CONSTRAINT "chunk_versions_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
