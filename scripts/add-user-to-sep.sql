-- Add a user to the SEP space by phone number
-- Replace '3853687238' with the actual phone number (10 digits, no formatting)

-- First, find the user and SEP space
DO $$
DECLARE
    v_user_id TEXT;
    v_space_id TEXT;
    v_phone TEXT := '3853687238'; -- Change this to the phone number you want to add
BEGIN
    -- Find user by phone number
    SELECT id INTO v_user_id
    FROM "User"
    WHERE "phoneNumber" = v_phone;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User with phone number % not found', v_phone;
    END IF;
    
    -- Find SEP space
    SELECT id INTO v_space_id
    FROM "Space"
    WHERE slug = 'sep';
    
    IF v_space_id IS NULL THEN
        RAISE EXCEPTION 'SEP space not found';
    END IF;
    
    -- Check if already a member
    IF EXISTS (
        SELECT 1 FROM "SpaceMember"
        WHERE "spaceId" = v_space_id AND "userId" = v_user_id
    ) THEN
        RAISE NOTICE 'User % is already a member of SEP space', v_phone;
    ELSE
        -- Add as member
        INSERT INTO "SpaceMember" ("id", "spaceId", "userId", "role", "joinedAt", "optedOut")
        VALUES (
            gen_random_uuid()::TEXT,
            v_space_id,
            v_user_id,
            'member',
            NOW(),
            false
        );
        RAISE NOTICE 'Successfully added user % to SEP space', v_phone;
    END IF;
END $$;
