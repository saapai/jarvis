-- Add unique constraint to prevent duplicate scheduled announcements from same Slack message
-- First, remove any existing duplicates (keep the earliest one)
DELETE FROM "ScheduledAnnouncement" a
USING "ScheduledAnnouncement" b
WHERE a."sourceMessageTs" IS NOT NULL
  AND a."sourceMessageTs" = b."sourceMessageTs"
  AND a."createdAt" > b."createdAt";

-- Now add the unique constraint
CREATE UNIQUE INDEX "ScheduledAnnouncement_sourceMessageTs_key" ON "ScheduledAnnouncement"("sourceMessageTs");
