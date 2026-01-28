-- Remove phone number from SEP space
-- Usage: Replace '3853687238' with your phone number
-- Example: psql $DATABASE_URL -f scripts/remove-phone-from-sep.sql

DO $$
DECLARE
    v_phone TEXT := '3853687238'; -- Replace with your phone number
    v_normalized_phone TEXT;
    v_sep_space_id TEXT;
    v_user_id TEXT;
    v_membership_id TEXT;
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
    
    -- Find user
    SELECT id INTO v_user_id
    FROM "User"
    WHERE "phoneNumber" = v_normalized_phone;
    
    IF v_user_id IS NULL THEN
        RAISE NOTICE 'User % not found', v_normalized_phone;
        RETURN;
    END IF;
    
    -- Find membership
    SELECT id INTO v_membership_id
    FROM "SpaceMember"
    WHERE "spaceId" = v_sep_space_id
      AND "userId" = v_user_id;
    
    IF v_membership_id IS NULL THEN
        RAISE NOTICE 'User % is not a member of SEP space', v_normalized_phone;
        RETURN;
    END IF;
    
    -- Remove membership
    DELETE FROM "SpaceMember"
    WHERE id = v_membership_id;
    
    RAISE NOTICE 'Successfully removed % from SEP space', v_normalized_phone;
END $$;
