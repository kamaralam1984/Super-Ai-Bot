-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'IDLE', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageFeedback" AS ENUM ('NONE', 'LIKE', 'DISLIKE');

-- CreateEnum
CREATE TYPE "EscalationReason" AS ENUM ('HUMAN_REQUESTED', 'LOW_CONFIDENCE', 'SENSITIVE_TOPIC', 'REPEATED_FAILURE', 'COMPLAINT', 'LEGAL', 'BILLING_DISPUTE', 'TECHNICAL_BEYOND_KNOWLEDGE');

-- CreateEnum
CREATE TYPE "EscalationChannel" AS ENUM ('LIVE_AGENT', 'EMAIL', 'TICKET', 'CALLBACK');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "PermissionEventType_new" AS ENUM ('WIZARD_COMPLETED', 'GRANTED', 'REVOKED', 'ACCESS_CHECKED', 'ACCESS_DENIED');
ALTER TABLE "permission_events" ALTER COLUMN "eventType" TYPE "PermissionEventType_new" USING ("eventType"::text::"PermissionEventType_new");
ALTER TYPE "PermissionEventType" RENAME TO "PermissionEventType_old";
ALTER TYPE "PermissionEventType_new" RENAME TO "PermissionEventType";
DROP TYPE "PermissionEventType_old";
COMMIT;

-- CreateTable
CREATE TABLE "visitors" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preferredLanguage" TEXT,
    "metadata" JSONB,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "language" TEXT,
    "topicSummary" TEXT,
    "shareToken" TEXT,
    "shareTokenExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "encryptedContent" TEXT NOT NULL,
    "intent" TEXT,
    "entities" JSONB,
    "language" TEXT,
    "sources" JSONB,
    "confidence" DOUBLE PRECISION,
    "tookMs" INTEGER,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "feedback" "MessageFeedback" NOT NULL DEFAULT 'NONE',
    "regeneratedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_tickets" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "reason" "EscalationReason" NOT NULL,
    "channel" "EscalationChannel" NOT NULL,
    "status" "EscalationStatus" NOT NULL DEFAULT 'OPEN',
    "triggeredBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "escalation_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visitors_installationId_fingerprint_key" ON "visitors"("installationId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_shareToken_key" ON "conversations"("shareToken");

-- CreateIndex
CREATE INDEX "conversations_installationId_status_idx" ON "conversations"("installationId", "status");

-- CreateIndex
CREATE INDEX "conversations_visitorId_idx" ON "conversations"("visitorId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "escalation_tickets_installationId_status_idx" ON "escalation_tickets"("installationId", "status");

-- CreateIndex
CREATE INDEX "escalation_tickets_conversationId_idx" ON "escalation_tickets"("conversationId");

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_regeneratedFromId_fkey" FOREIGN KEY ("regeneratedFromId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_tickets" ADD CONSTRAINT "escalation_tickets_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_tickets" ADD CONSTRAINT "escalation_tickets_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

