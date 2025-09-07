-- Migration: Add time and UI preference columns to user_preferences table
-- Run this in your Supabase SQL Editor

-- Add the missing columns for time and UI preferences
ALTER TABLE user_preferences 
ADD COLUMN IF NOT EXISTS start_minutes INTEGER DEFAULT 360,  -- 6:00 AM in minutes
ADD COLUMN IF NOT EXISTS end_minutes INTEGER DEFAULT 1320,   -- 10:00 PM in minutes  
ADD COLUMN IF NOT EXISTS slot_minutes INTEGER DEFAULT 20,
ADD COLUMN IF NOT EXISTS week_starts_on TEXT DEFAULT 'Monday' CHECK (week_starts_on IN ('Monday', 'Sunday')),
ADD COLUMN IF NOT EXISTS max_objectives INTEGER DEFAULT 6 CHECK (max_objectives >= 1 AND max_objectives <= 20),
ADD COLUMN IF NOT EXISTS tick_color TEXT DEFAULT '#16a34a',
ADD COLUMN IF NOT EXISTS show_objective_names BOOLEAN DEFAULT false;

-- Add comments for clarity
COMMENT ON COLUMN user_preferences.start_minutes IS 'Start time of day in minutes from midnight (e.g. 360 = 6:00 AM)';
COMMENT ON COLUMN user_preferences.end_minutes IS 'End time of day in minutes from midnight (e.g. 1320 = 10:00 PM)';
COMMENT ON COLUMN user_preferences.slot_minutes IS 'Duration of each time slot in minutes';
COMMENT ON COLUMN user_preferences.week_starts_on IS 'First day of the week (Monday or Sunday)';
COMMENT ON COLUMN user_preferences.max_objectives IS 'Maximum number of objectives allowed';
COMMENT ON COLUMN user_preferences.tick_color IS 'Color for completion indicators (hex color)';
COMMENT ON COLUMN user_preferences.show_objective_names IS 'Whether to show objective names in schedule cells';

-- Update the RLS policy if needed (ensure users can only access their own preferences)
-- This should already exist from previous migrations, but let's make sure
DO $$ 
BEGIN
    -- Drop existing policies if they exist
    DROP POLICY IF EXISTS "Users can view own preferences" ON user_preferences;
    DROP POLICY IF EXISTS "Users can insert own preferences" ON user_preferences;  
    DROP POLICY IF EXISTS "Users can update own preferences" ON user_preferences;

    -- Create comprehensive RLS policies
    CREATE POLICY "Users can view own preferences" ON user_preferences
        FOR SELECT USING (auth.uid() = user_id);
    
    CREATE POLICY "Users can insert own preferences" ON user_preferences
        FOR INSERT WITH CHECK (auth.uid() = user_id);
        
    CREATE POLICY "Users can update own preferences" ON user_preferences
        FOR UPDATE USING (auth.uid() = user_id);
END $$;

-- Verify the new structure
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'user_preferences'
ORDER BY ordinal_position;