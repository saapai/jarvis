/*
  Warnings:

  - The primary key for the `ConversationState` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `SlackSync` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[phoneNumber,spaceId]` on the table `ConversationState` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[spaceId,channelName]` on the table `SlackSync` will be added. If there are existing duplicate values, this will fail.
  - The required column `id` was added to the `ConversationState` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `SlackSync` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- Set search_path to include dev and public (for extensions)
SET search_path = dev, public;

-- Note: pgvector extension is already enabled in Supabase, no need to create it here

-- DropIndex
DROP INDEX "Fact_embedding_idx";

-- AlterTable
ALTER TABLE "AnnouncementDraft" ADD COLUMN     "spaceId" TEXT;

-- AlterTable
ALTER TABLE "ConversationState" DROP CONSTRAINT "ConversationState_pkey",
ADD COLUMN     "activeSpaceId" TEXT,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "spaceId" TEXT,
ADD CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Fact" ADD COLUMN     "spaceId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "spaceId" TEXT;

-- AlterTable
ALTER TABLE "PollMeta" ADD COLUMN     "spaceId" TEXT;

-- AlterTable
ALTER TABLE "ScheduledAnnouncement" ADD COLUMN     "spaceId" TEXT;

-- AlterTable
ALTER TABLE "SlackSync" DROP CONSTRAINT "SlackSync_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "spaceId" TEXT,
ADD CONSTRAINT "SlackSync_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "spaceId" TEXT;

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "createdBy" TEXT NOT NULL,
    "category" TEXT,
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "morningReminderSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "spaceId" TEXT,
    "linkedFactId" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_eventDate_reminderSent_idx" ON "Event"("eventDate", "reminderSent");

-- CreateIndex
CREATE INDEX "Event_eventDate_morningReminderSent_idx" ON "Event"("eventDate", "morningReminderSent");

-- CreateIndex
CREATE INDEX "Event_spaceId_eventDate_idx" ON "Event"("spaceId", "eventDate");

-- CreateIndex
CREATE INDEX "AnnouncementDraft_spaceId_phoneNumber_status_idx" ON "AnnouncementDraft"("spaceId", "phoneNumber", "status");

-- CreateIndex
CREATE INDEX "ConversationState_phoneNumber_idx" ON "ConversationState"("phoneNumber");

-- CreateIndex
CREATE INDEX "ConversationState_spaceId_idx" ON "ConversationState"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationState_phoneNumber_spaceId_key" ON "ConversationState"("phoneNumber", "spaceId");

-- CreateIndex
CREATE INDEX "Fact_spaceId_idx" ON "Fact"("spaceId");

-- CreateIndex
CREATE INDEX "Message_spaceId_phoneNumber_createdAt_idx" ON "Message"("spaceId", "phoneNumber", "createdAt");

-- CreateIndex
CREATE INDEX "PollMeta_spaceId_isActive_createdAt_idx" ON "PollMeta"("spaceId", "isActive", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledAnnouncement_spaceId_scheduledFor_sent_idx" ON "ScheduledAnnouncement"("spaceId", "scheduledFor", "sent");

-- CreateIndex
CREATE INDEX "SlackSync_spaceId_idx" ON "SlackSync"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SlackSync_spaceId_channelName_key" ON "SlackSync"("spaceId", "channelName");

-- CreateIndex
CREATE INDEX "Upload_spaceId_idx" ON "Upload"("spaceId");

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationState" ADD CONSTRAINT "ConversationState_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementDraft" ADD CONSTRAINT "AnnouncementDraft_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollMeta" ADD CONSTRAINT "PollMeta_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_linkedFactId_fkey" FOREIGN KEY ("linkedFactId") REFERENCES "Fact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlackSync" ADD CONSTRAINT "SlackSync_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledAnnouncement" ADD CONSTRAINT "ScheduledAnnouncement_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
