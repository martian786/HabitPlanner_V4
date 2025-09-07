-- Add archived field to objectives table for soft delete functionality
-- Run this migration in your Supabase SQL editor

ALTER TABLE objectives 
ADD COLUMN archived BOOLEAN DEFAULT FALSE;

-- Create index for better query performance on archived field
CREATE INDEX IF NOT EXISTS idx_objectives_archived 
ON objectives (user_id, archived) 
WHERE archived IS FALSE OR archived IS NULL;

-- Create user preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    show_archived BOOLEAN DEFAULT FALSE,
    delete_mode TEXT DEFAULT 'soft' CHECK (delete_mode IN ('soft', 'hard')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Enable RLS on user preferences
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for user preferences
CREATE POLICY "Users can manage their own preferences" ON user_preferences
    FOR ALL USING (auth.uid() = user_id);

-- Create index on user_id for performance
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- Update existing objectives to have archived = false explicitly (optional)
-- UPDATE objectives SET archived = FALSE WHERE archived IS NULL;