-- Migration: Update existing users to have show_objective_names and prevent_overwrite set to true
-- WARNING: This will change settings for ALL existing users
-- Run this in your Supabase SQL Editor

-- First, check how many users will be affected and their current settings
SELECT 
    COUNT(*) as total_users,
    SUM(CASE WHEN show_objective_names = false OR show_objective_names IS NULL THEN 1 ELSE 0 END) as users_with_names_off,
    SUM(CASE WHEN prevent_overwrite = false OR prevent_overwrite IS NULL THEN 1 ELSE 0 END) as users_with_overwrite_off
FROM user_preferences;

-- Update all existing users to have both settings as true
-- This will only update users who currently have these set to false or NULL
UPDATE user_preferences 
SET 
    show_objective_names = true,
    prevent_overwrite = true
WHERE 
    show_objective_names = false 
    OR show_objective_names IS NULL
    OR prevent_overwrite = false 
    OR prevent_overwrite IS NULL;

-- Verify the update
SELECT 
    COUNT(*) as total_users,
    SUM(CASE WHEN show_objective_names = true THEN 1 ELSE 0 END) as users_with_names_on,
    SUM(CASE WHEN prevent_overwrite = true THEN 1 ELSE 0 END) as users_with_overwrite_on
FROM user_preferences;

-- Optional: If you want to update ONLY users who haven't explicitly set these preferences
-- (i.e., they're using defaults), you could use this more conservative approach instead:
/*
UPDATE user_preferences 
SET 
    show_objective_names = COALESCE(show_objective_names, true),
    prevent_overwrite = COALESCE(prevent_overwrite, true)
WHERE 
    show_objective_names IS NULL 
    OR prevent_overwrite IS NULL;
*/