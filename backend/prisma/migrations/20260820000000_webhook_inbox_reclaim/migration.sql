-- AlterTable
ALTER TABLE "WebhookInboxEvent" ADD COLUMN     "reclaimAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "redriveSpec" JSONB;

-- CreateIndex
CREATE INDEX "OutboxMessage_jobId_idx" ON "OutboxMessage"("jobId");

