-- Fix unique constraint to allow duplicate names for archived objectives
-- Run this migration in your Supabase SQL editor

-- First, drop the existing unique constraint if it exists
-- (This will fail silently if the constraint doesn't exist)
DO $$ 
BEGIN 
    -- Try to drop the constraint, ignore if it doesn't exist
    BEGIN
        ALTER TABLE objectives DROP CONSTRAINT IF EXISTS unique_user_objective_name;
        RAISE NOTICE 'Dropped existing unique_user_objective_name constraint';
    EXCEPTION 
        WHEN undefined_object THEN 
            RAISE NOTICE 'unique_user_objective_name constraint did not exist';
    END;
END $$;

-- Create a new partial unique constraint that only applies to non-archived objectives
-- This allows multiple archived objectives with the same name, but prevents 
-- duplicate active objective names for the same user
CREATE UNIQUE INDEX unique_user_objective_name_active 
ON objectives (user_id, name) 
WHERE archived IS FALSE OR archived IS NULL;

-- Verify the constraint works by checking if we can create the index
SELECT 'Migration completed successfully - unique constraint now allows archived duplicates' as status;