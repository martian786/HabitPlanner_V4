-- Migration: Update default values for show_objective_names and prevent_overwrite
-- This only affects NEW users, existing users keep their current settings
-- Run this in your Supabase SQL Editor

-- Update default for show_objective_names to true
ALTER TABLE user_preferences 
ALTER COLUMN show_objective_names SET DEFAULT true;

-- Update default for prevent_overwrite to true
ALTER TABLE user_preferences 
ALTER COLUMN prevent_overwrite SET DEFAULT true;

-- Verify the new defaults (should show true for both)
SELECT 
    column_name, 
    data_type, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'user_preferences' 
AND column_name IN ('show_objective_names', 'prevent_overwrite');

-- Note: This migration does NOT update existing user records
-- Only new users created after this migration will get the new defaults