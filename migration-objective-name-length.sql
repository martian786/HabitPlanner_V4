-- Migration: Add constraint for objective name length
-- This enforces a maximum length of 24 characters at the database level
-- Run this in your Supabase SQL Editor

-- First, check if any existing objectives exceed the new limit
SELECT 
    id,
    name,
    LENGTH(name) as name_length,
    user_id
FROM objectives
WHERE LENGTH(name) > 24
ORDER BY LENGTH(name) DESC;

-- If the above query returns results, you may want to truncate them first:
-- UPDATE objectives 
-- SET name = LEFT(name, 24)
-- WHERE LENGTH(name) > 24;

-- Add check constraint to enforce maximum length
ALTER TABLE objectives 
ADD CONSTRAINT objective_name_max_length 
CHECK (LENGTH(name) <= 24);

-- Verify the constraint was added
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'objectives'::regclass
AND conname = 'objective_name_max_length';

-- Optional: Add a comment for documentation
COMMENT ON CONSTRAINT objective_name_max_length ON objectives 
IS 'Ensures objective names do not exceed 24 characters';