-- Migration script to assign all existing data to the SEP space
-- This updates all NULL spaceId values to the SEP space ID

DO $$
DECLARE
  sep_space_id TEXT;
BEGIN
  -- Find the SEP space ID (by slug 'sep')
  SELECT id INTO sep_space_id
  FROM public."Space"
  WHERE slug = 'sep'
  LIMIT 1;

  -- If SEP space doesn't exist, raise an error
  IF sep_space_id IS NULL THEN
    RAISE EXCEPTION 'SEP space not found. Please create it first using create-sep-space-and-add-members.sql';
  END IF;

  RAISE NOTICE 'Found SEP space ID: %', sep_space_id;

  -- Update all tables with spaceId columns
  -- Only update rows where spaceId IS NULL to avoid overwriting existing assignments

  -- Update Fact table
  UPDATE public."Fact"
  SET "spaceId" = sep_space_id
  WHERE "spaceId" IS NULL;
  
  RAISE NOTICE 'Updated % facts', (SELECT COUNT(*) FROM public."Fact" WHERE "spaceId" = sep_space_id);

  -- Update Upload table
  UPDATE public."Upload"
  SET "spaceId" = sep_space_id
  WHERE "spaceId" IS NULL;
  
  RAISE NOTICE 'Updated % uploads', (SELECT COUNT(*) FROM public."Upload" WHERE "spaceId" = sep_space_id);

  -- Update Message table
  UPDATE public."Message"
  SET "spaceId" = sep_space_id
  WHERE "spaceId" IS NULL;
  
  RAISE NOTICE 'Updated % messages', (SELECT COUNT(*) FROM public."Message" WHERE "spaceId" = sep_space_id);

  -- Update ConversationState table
  UPDATE public."ConversationState"
  SET "spaceId" = sep_space_id
  WHERE "spaceId" IS NULL;
  
  RAISE NOTICE 'Updated % conversation states', (SELECT COUNT(*) FROM public."ConversationState" WHERE "spaceId" = sep_space_id);

  -- Update AnnouncementDraft table
  UPDATE public."AnnouncementDraft"
  SET "spaceId" = sep_space_id
  WHERE "spaceId" IS NULL;
  
  RAISE NOTICE 'Updated % announcement drafts', (SELECT COUNT(*) FROM public."AnnouncementDraft" WHERE "spaceId" = sep_space_id);

  -- Update PollMeta table
  UPDATE public."PollMeta"
  SET "spaceId" = sep_space_id
  WHERE "spaceId" IS NULL;
  
  RAISE NOTICE 'Updated % polls', (SELECT COUNT(*) FROM public."PollMeta" WHERE "spaceId" = sep_space_id);

  -- Update Event table
  UPDATE public."Event"
  SET "spaceId" = sep_space_id
  WHERE "spaceId" IS NULL;
  
  RAISE NOTICE 'Updated % events', (SELECT COUNT(*) FROM public."Event" WHERE "spaceId" = sep_space_id);

  -- Update SlackSync table
  UPDATE public."SlackSync"
  SET "spaceId" = sep_space_id
  WHERE "spaceId" IS NULL;
  
  RAISE NOTICE 'Updated % slack syncs', (SELECT COUNT(*) FROM public."SlackSync" WHERE "spaceId" = sep_space_id);

  -- Update ScheduledAnnouncement table
  UPDATE public."ScheduledAnnouncement"
  SET "spaceId" = sep_space_id
  WHERE "spaceId" IS NULL;
  
  RAISE NOTICE 'Updated % scheduled announcements', (SELECT COUNT(*) FROM public."ScheduledAnnouncement" WHERE "spaceId" = sep_space_id);

  RAISE NOTICE 'Migration completed successfully! All existing data has been assigned to the SEP space.';
END $$;
