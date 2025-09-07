-- Add Results field constraint for reflection data
-- Run this migration in your Supabase SQL editor

-- Add check constraint for results field length
ALTER TABLE weeks 
ADD CONSTRAINT check_reflection_results_length 
CHECK (
  (reflections IS NULL) OR 
  (jsonb_typeof(reflections) != 'object') OR
  (
    SELECT bool_and(
      (value->'results' IS NULL) OR 
      (length(value->>'results') <= 250)
    )
    FROM jsonb_each(reflections) AS t(key, value)
  )
);

-- Test the constraint (optional)
-- This should succeed:
-- INSERT INTO weeks (user_id, week_start, reflections) 
-- VALUES (auth.uid(), '2024-01-01', '{"2024-01-01": {"results": "Short results text", "proud": "Proud text"}}');

-- This should fail:
-- INSERT INTO weeks (user_id, week_start, reflections) 
-- VALUES (auth.uid(), '2024-01-02', '{"2024-01-02": {"results": "' || repeat('x', 251) || '"}}');