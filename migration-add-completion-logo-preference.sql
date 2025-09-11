-- Add show_completion_logo preference to user_preferences table
-- Run this migration in your Supabase SQL editor

ALTER TABLE user_preferences 
ADD COLUMN show_completion_logo BOOLEAN DEFAULT FALSE;

-- Update existing users to have the feature disabled by default
UPDATE user_preferences 
SET show_completion_logo = FALSE 
WHERE show_completion_logo IS NULL;