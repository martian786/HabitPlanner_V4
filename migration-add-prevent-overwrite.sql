-- Migration: Add prevent_overwrite column to user_preferences table
-- Run this in your Supabase SQL Editor

-- Add the prevent_overwrite column
ALTER TABLE user_preferences 
ADD COLUMN IF NOT EXISTS prevent_overwrite BOOLEAN DEFAULT false;

-- Add comment for clarity
COMMENT ON COLUMN user_preferences.prevent_overwrite IS 'Whether to prevent overwriting existing calendar cells with different objectives';

-- Verify the new structure
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'user_preferences' AND column_name = 'prevent_overwrite';