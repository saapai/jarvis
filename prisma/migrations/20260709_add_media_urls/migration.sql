-- AlterTable
ALTER TABLE "ScheduledAnnouncement" ADD COLUMN IF NOT EXISTS "mediaUrls" JSONB;
