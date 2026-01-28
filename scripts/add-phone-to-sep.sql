-- Add phone number to SEP space
-- Usage: Replace '3853687238' with your phone number
-- Example: psql $DATABASE_URL -f scripts/add-phone-to-sep.sql

DO $$
DECLARE
    v_phone TEXT := '3853687238'; -- Replace with your phone number
    v_normalized_phone TEXT;
    v_sep_space_id TEXT;
    v_user_id TEXT;
    v_existing_membership_id TEXT;
BEGIN
    -- Normalize phone number (remove non-digits, handle 11-digit numbers starting with 1)
    -- Logic: If 11 digits and starts with '1', remove first digit. Otherwise take last 10 digits.
    v_normalized_phone := (
        WITH digits AS (
            SELECT REGEXP_REPLACE(v_phone, '[^0-9]', '', 'g') AS cleaned
        )
        SELECT CASE 
            WHEN LENGTH(cleaned) = 11 AND SUBSTRING(cleaned FROM 1 FOR 1) = '1'
            THEN SUBSTRING(cleaned FROM 2)
            ELSE RIGHT(cleaned, 10)
        END
        FROM digits
    );
    
    RAISE NOTICE 'Normalized phone: %', v_normalized_phone;
    
    -- Find SEP space
    SELECT id INTO v_sep_space_id
    FROM "Space"
    WHERE slug = 'sep';
    
    IF v_sep_space_id IS NULL THEN
        RAISE EXCEPTION 'SEP space not found';
    END IF;
    
    RAISE NOTICE 'Found SEP space: %', v_sep_space_id;
    
    -- Get or create user
    INSERT INTO "User" ("id", "phoneNumber", "createdAt")
    VALUES (gen_random_uuid()::TEXT, v_normalized_phone, NOW())
    ON CONFLICT ("phoneNumber") DO NOTHING
    RETURNING id INTO v_user_id;
    
    -- If user already existed, get their ID
    IF v_user_id IS NULL THEN
        SELECT id INTO v_user_id
        FROM "User"
        WHERE "phoneNumber" = v_normalized_phone;
        RAISE NOTICE 'Found existing user: %', v_user_id;
    ELSE
        RAISE NOTICE 'Created user: %', v_user_id;
    END IF;
    
    -- Check if already a member
    SELECT id INTO v_existing_membership_id
    FROM "SpaceMember"
    WHERE "spaceId" = v_sep_space_id
      AND "userId" = v_user_id;
    
    IF v_existing_membership_id IS NOT NULL THEN
        -- If opted out, re-enable
        UPDATE "SpaceMember"
        SET "optedOut" = false
        WHERE id = v_existing_membership_id
          AND "optedOut" = true;
        
        IF FOUND THEN
            RAISE NOTICE 'Re-enabled % in SEP space (was opted out)', v_normalized_phone;
        ELSE
            RAISE NOTICE 'User % is already a member of SEP space', v_normalized_phone;
        END IF;
        RETURN;
    END IF;
    
    -- Add as member
    INSERT INTO "SpaceMember" ("id", "spaceId", "userId", "role", "joinedAt", "optedOut")
    VALUES (gen_random_uuid()::TEXT, v_sep_space_id, v_user_id, 'member', NOW(), false);
    
    RAISE NOTICE 'Successfully added % to SEP space', v_normalized_phone;
END $$;
