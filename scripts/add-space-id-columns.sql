-- Add spaceId columns to all tables that need them for multi-tenancy
-- This migration adds spaceId columns and foreign keys to existing tables

BEGIN;

-- Add spaceId to Upload table
ALTER TABLE public."Upload" 
ADD COLUMN IF NOT EXISTS "spaceId" TEXT;

CREATE INDEX IF NOT EXISTS "Upload_spaceId_idx" ON public."Upload"("spaceId");

-- Add spaceId to Fact table
ALTER TABLE public."Fact" 
ADD COLUMN IF NOT EXISTS "spaceId" TEXT;

CREATE INDEX IF NOT EXISTS "Fact_spaceId_idx" ON public."Fact"("spaceId");

-- Add spaceId to Message table
ALTER TABLE public."Message" 
ADD COLUMN IF NOT EXISTS "spaceId" TEXT;

CREATE INDEX IF NOT EXISTS "Message_spaceId_idx" ON public."Message"("spaceId");
CREATE INDEX IF NOT EXISTS "Message_spaceId_phoneNumber_createdAt_idx" ON public."Message"("spaceId", "phoneNumber", "createdAt");

-- Add id column to ConversationState if it doesn't exist (migration from phoneNumber as PK)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'ConversationState' 
                   AND column_name = 'id') THEN
        ALTER TABLE public."ConversationState" 
        ADD COLUMN "id" TEXT DEFAULT gen_random_uuid()::TEXT;
        
        -- Update existing rows to have unique IDs
        UPDATE public."ConversationState" 
        SET "id" = gen_random_uuid()::TEXT 
        WHERE "id" IS NULL;
        
        -- Drop old primary key
        ALTER TABLE public."ConversationState" 
        DROP CONSTRAINT IF EXISTS "ConversationState_pkey";
        
        -- Add new primary key on id
        ALTER TABLE public."ConversationState" 
        ADD CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("id");
    END IF;
END $$;

-- Add spaceId to ConversationState table
ALTER TABLE public."ConversationState" 
ADD COLUMN IF NOT EXISTS "spaceId" TEXT;

-- Add activeSpaceId to ConversationState table
ALTER TABLE public."ConversationState" 
ADD COLUMN IF NOT EXISTS "activeSpaceId" TEXT;

CREATE INDEX IF NOT EXISTS "ConversationState_spaceId_idx" ON public."ConversationState"("spaceId");
CREATE INDEX IF NOT EXISTS "ConversationState_phoneNumber_idx" ON public."ConversationState"("phoneNumber");

-- Add unique constraint on phoneNumber and spaceId
ALTER TABLE public."ConversationState" 
DROP CONSTRAINT IF EXISTS "ConversationState_phoneNumber_spaceId_key";

ALTER TABLE public."ConversationState" 
ADD CONSTRAINT "ConversationState_phoneNumber_spaceId_key" 
UNIQUE ("phoneNumber", COALESCE("spaceId", ''));

-- Add spaceId to AnnouncementDraft table
ALTER TABLE public."AnnouncementDraft" 
ADD COLUMN IF NOT EXISTS "spaceId" TEXT;

CREATE INDEX IF NOT EXISTS "AnnouncementDraft_spaceId_idx" ON public."AnnouncementDraft"("spaceId");
CREATE INDEX IF NOT EXISTS "AnnouncementDraft_spaceId_phoneNumber_status_idx" ON public."AnnouncementDraft"("spaceId", "phoneNumber", "status");

-- Add spaceId to PollMeta table
ALTER TABLE public."PollMeta" 
ADD COLUMN IF NOT EXISTS "spaceId" TEXT;

CREATE INDEX IF NOT EXISTS "PollMeta_spaceId_idx" ON public."PollMeta"("spaceId");
CREATE INDEX IF NOT EXISTS "PollMeta_spaceId_isActive_createdAt_idx" ON public."PollMeta"("spaceId", "isActive", "createdAt");

-- Add spaceId to Event table
ALTER TABLE public."Event" 
ADD COLUMN IF NOT EXISTS "spaceId" TEXT;

CREATE INDEX IF NOT EXISTS "Event_spaceId_idx" ON public."Event"("spaceId");
CREATE INDEX IF NOT EXISTS "Event_spaceId_eventDate_idx" ON public."Event"("spaceId", "eventDate");

-- Add id column to SlackSync if it doesn't exist (migration from channelName as PK)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'SlackSync' 
                   AND column_name = 'id') THEN
        ALTER TABLE public."SlackSync" 
        ADD COLUMN "id" TEXT DEFAULT gen_random_uuid()::TEXT;
        
        -- Update existing rows to have unique IDs
        UPDATE public."SlackSync" 
        SET "id" = gen_random_uuid()::TEXT 
        WHERE "id" IS NULL;
        
        -- Drop old primary key
        ALTER TABLE public."SlackSync" 
        DROP CONSTRAINT IF EXISTS "SlackSync_pkey";
        
        -- Add new primary key on id
        ALTER TABLE public."SlackSync" 
        ADD CONSTRAINT "SlackSync_pkey" PRIMARY KEY ("id");
    END IF;
END $$;

-- Add spaceId to SlackSync table
ALTER TABLE public."SlackSync" 
ADD COLUMN IF NOT EXISTS "spaceId" TEXT;

CREATE INDEX IF NOT EXISTS "SlackSync_spaceId_idx" ON public."SlackSync"("spaceId");

-- Add unique constraint on spaceId and channelName
ALTER TABLE public."SlackSync" 
DROP CONSTRAINT IF EXISTS "SlackSync_spaceId_channelName_key";

ALTER TABLE public."SlackSync" 
ADD CONSTRAINT "SlackSync_spaceId_channelName_key" 
UNIQUE (COALESCE("spaceId", ''), "channelName");

-- Add spaceId to ScheduledAnnouncement table
ALTER TABLE public."ScheduledAnnouncement" 
ADD COLUMN IF NOT EXISTS "spaceId" TEXT;

CREATE INDEX IF NOT EXISTS "ScheduledAnnouncement_spaceId_idx" ON public."ScheduledAnnouncement"("spaceId");
CREATE INDEX IF NOT EXISTS "ScheduledAnnouncement_spaceId_scheduledFor_sent_idx" ON public."ScheduledAnnouncement"("spaceId", "scheduledFor", "sent");

-- Add foreign key constraints (with ON DELETE CASCADE)
ALTER TABLE public."Upload" 
ADD CONSTRAINT "Upload_spaceId_fkey" 
FOREIGN KEY ("spaceId") REFERENCES public."Space"("id") ON DELETE CASCADE;

ALTER TABLE public."Fact" 
ADD CONSTRAINT "Fact_spaceId_fkey" 
FOREIGN KEY ("spaceId") REFERENCES public."Space"("id") ON DELETE CASCADE;

ALTER TABLE public."Message" 
ADD CONSTRAINT "Message_spaceId_fkey" 
FOREIGN KEY ("spaceId") REFERENCES public."Space"("id") ON DELETE CASCADE;

ALTER TABLE public."ConversationState" 
ADD CONSTRAINT "ConversationState_spaceId_fkey" 
FOREIGN KEY ("spaceId") REFERENCES public."Space"("id") ON DELETE CASCADE;

ALTER TABLE public."AnnouncementDraft" 
ADD CONSTRAINT "AnnouncementDraft_spaceId_fkey" 
FOREIGN KEY ("spaceId") REFERENCES public."Space"("id") ON DELETE CASCADE;

ALTER TABLE public."PollMeta" 
ADD CONSTRAINT "PollMeta_spaceId_fkey" 
FOREIGN KEY ("spaceId") REFERENCES public."Space"("id") ON DELETE CASCADE;

ALTER TABLE public."Event" 
ADD CONSTRAINT "Event_spaceId_fkey" 
FOREIGN KEY ("spaceId") REFERENCES public."Space"("id") ON DELETE CASCADE;

ALTER TABLE public."SlackSync" 
ADD CONSTRAINT "SlackSync_spaceId_fkey" 
FOREIGN KEY ("spaceId") REFERENCES public."Space"("id") ON DELETE CASCADE;

ALTER TABLE public."ScheduledAnnouncement" 
ADD CONSTRAINT "ScheduledAnnouncement_spaceId_fkey" 
FOREIGN KEY ("spaceId") REFERENCES public."Space"("id") ON DELETE CASCADE;

COMMIT;
