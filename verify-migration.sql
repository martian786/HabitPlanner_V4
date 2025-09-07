-- Verification script to check if migration was successful
-- Run this in your Supabase SQL Editor to verify the setup

-- 1. Check if archived column exists in objectives table
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'objectives' 
AND column_name = 'archived';

-- 2. Check if user_preferences table exists and has correct structure
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'user_preferences'
ORDER BY ordinal_position;

-- 3. Check if indexes were created
SELECT 
    indexname, 
    indexdef 
FROM pg_indexes 
WHERE tablename IN ('objectives', 'user_preferences')
AND indexname LIKE '%archived%' OR indexname LIKE '%user_preferences%';

-- 4. Check RLS policies on user_preferences
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    permissive, 
    roles, 
    cmd, 
    qual
FROM pg_policies 
WHERE tablename = 'user_preferences';

-- 5. Test inserting a sample preference (optional - will fail if already exists)
-- INSERT INTO user_preferences (user_id, show_archived, delete_mode) 
-- VALUES (auth.uid(), false, 'soft');

-- 6. Check if we can query user_preferences (should return empty if no preferences set)
SELECT * FROM user_preferences WHERE user_id = auth.uid();