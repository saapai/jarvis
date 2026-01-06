-- Migration: add_events
-- Add Event table for proactive reminder system

CREATE TABLE IF NOT EXISTS "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "linkedFactId" TEXT,
    CONSTRAINT "Event_linkedFactId_fkey" FOREIGN KEY ("linkedFactId") REFERENCES "Fact"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Create indexes for efficient reminder queries
CREATE INDEX IF NOT EXISTS "Event_eventDate_reminderSent_idx" ON "Event"("eventDate", "reminderSent");
CREATE INDEX IF NOT EXISTS "Event_eventDate_morningReminderSent_idx" ON "Event"("eventDate", "morningReminderSent");

-- Verify the table was created
SELECT 'Migration successful! Event table created.' as status;

