-- Create SEP space and add all members with names
-- This script creates the SEP space, creates/updates users, and adds them as members

DO $$
DECLARE
    v_space_id TEXT;
    v_owner_id TEXT;
    v_user_id TEXT;
    v_phone TEXT;
    v_name TEXT;
    v_normalized_phone TEXT;
    
    -- Phone numbers and names
    phone_data RECORD;
    phone_list TEXT[][] := ARRAY[
        ['3853687238', 'Saathvik'],
        ['9175288704', 'Aryan'],
        ['4259790010', 'Abby'],
        ['8588293100', 'Kevin'],
        ['3038450766', 'Quinn'],
        ['8573964806', 'Rahul'],
        ['3105717011', 'Ani'],
        ['3235091761', 'Johnathan'],
        ['4088051435', 'Arushi'],
        ['3105008359', 'Lindsey'],
        ['8588374987', 'elijah'],
        ['5083175184', 'Kit'],
        ['9252971911', 'Sharan'],
        ['3108737200', 'Huixi'],
        ['4244660408', 'layla'],
        ['5102196504', 'Beck'],
        ['4086490769', 'Joanna'],
        ['8189299990', 'Dilnar'],
        ['3105059297', 'Barima'],
        ['4438963819', 'Allie'],
        ['3232706359', 'kera'],
        ['4259791041', 'sonali'],
        ['3105971118', 'Elise'],
        ['5058199928', 'Ming'],
        ['8184398818', 'Mark'],
        ['9253369249', 'yashas'],
        ['9259008019', 'Gary'],
        ['4155359656', 'sophie'],
        ['5108993006', 'Brandon'],
        ['9132938404', 'Ash'],
        ['6573637311', 'Sidney'],
        ['3103673514', 'Joseph'],
        ['4692741037', 'Natalie'],
        ['9734376074', 'armaan bassi'],
        ['4086685541', 'Edward'],
        ['4698290081', 'Mahi'],
        ['4244075337', 'Ruhaan'],
        ['9967574792', 'Ruhaan'],
        ['6508636891', 'Anusha'],
        ['3107808121', 'Charlotte'],
        ['4249770401', NULL], -- no name
        ['7606930594', 'leilani'],
        ['3609314664', 'Simon'],
        ['4087636262', 'Henry'],
        ['8585275611', 'Tyler'],
        ['6505186293', 'Sophia'],
        ['3104866781', 'Anannya'],
        ['6508899373', 'Ani'],
        ['6503461001', 'Evan'],
        ['9494669092', 'Maddie'],
        ['6577240606', 'Darren'],
        ['5596531293', 'Matthew'],
        ['6264786106', 'Harrison'],
        ['4152718271', 'Fiona'],
        ['6196435215', 'Franco']
    ];
BEGIN
    -- Step 1: Create or get owner (first phone number: Saathvik)
    v_phone := phone_list[1][1];
    v_name := phone_list[1][2];
    
    SELECT id INTO v_owner_id
    FROM public."User"
    WHERE "phoneNumber" = v_phone;
    
    IF v_owner_id IS NULL THEN
        INSERT INTO public."User" (id, "phoneNumber", name, "createdAt")
        VALUES (gen_random_uuid()::TEXT, v_phone, v_name, NOW())
        RETURNING id INTO v_owner_id;
        RAISE NOTICE 'Created owner user: % (%)', v_name, v_phone;
    ELSE
        -- Update name if it exists
        IF v_name IS NOT NULL THEN
            UPDATE public."User" SET name = v_name WHERE id = v_owner_id;
        END IF;
        RAISE NOTICE 'Found existing owner user: % (%)', v_name, v_phone;
    END IF;
    
    -- Step 2: Create or get SEP space
    SELECT id INTO v_space_id
    FROM public."Space"
    WHERE slug = 'sep';
    
    IF v_space_id IS NULL THEN
        INSERT INTO public."Space" (id, name, slug, "joinCode", "ownerId", "createdAt", "airtableBaseId", "airtableTableName")
        VALUES (
            gen_random_uuid()::TEXT,
            'Enclave',
            'sep',
            'SEP',
            v_owner_id,
            NOW(),
            NULL, -- Set these if you have Airtable config
            'Enclave'
        )
        RETURNING id INTO v_space_id;
        RAISE NOTICE 'Created SEP space: %', v_space_id;
    ELSE
        RAISE NOTICE 'Found existing SEP space: %', v_space_id;
    END IF;
    
    -- Step 3: Add owner as member if not already
    IF NOT EXISTS (
        SELECT 1 FROM public."SpaceMember"
        WHERE "spaceId" = v_space_id AND "userId" = v_owner_id
    ) THEN
        INSERT INTO public."SpaceMember" (id, "spaceId", "userId", role, "joinedAt", "optedOut")
        VALUES (gen_random_uuid()::TEXT, v_space_id, v_owner_id, 'owner', NOW(), false);
        RAISE NOTICE 'Added owner as member';
    END IF;
    
    -- Step 4: Create/update all users and add them as members
    FOR i IN 1..array_length(phone_list, 1) LOOP
        v_phone := phone_list[i][1];
        v_name := phone_list[i][2];
        
        -- Get or create user
        SELECT id INTO v_user_id
        FROM public."User"
        WHERE "phoneNumber" = v_phone;
        
        IF v_user_id IS NULL THEN
            INSERT INTO public."User" (id, "phoneNumber", name, "createdAt")
            VALUES (gen_random_uuid()::TEXT, v_phone, v_name, NOW())
            RETURNING id INTO v_user_id;
            RAISE NOTICE 'Created user: % (%)', COALESCE(v_name, 'unnamed'), v_phone;
        ELSE
            -- Update name if provided and different
            IF v_name IS NOT NULL THEN
                UPDATE public."User" SET name = v_name WHERE id = v_user_id AND (name IS NULL OR name != v_name);
            END IF;
        END IF;
        
        -- Add as member if not already
        IF NOT EXISTS (
            SELECT 1 FROM public."SpaceMember"
            WHERE "spaceId" = v_space_id AND "userId" = v_user_id
        ) THEN
            INSERT INTO public."SpaceMember" (id, "spaceId", "userId", role, "joinedAt", "optedOut")
            VALUES (gen_random_uuid()::TEXT, v_space_id, v_user_id, 'member', NOW(), false);
            RAISE NOTICE 'Added % (%) as member', COALESCE(v_name, 'unnamed'), v_phone;
        END IF;
    END LOOP;
    
    RAISE NOTICE '✅ Completed! SEP space created/updated with all members.';
END $$;
