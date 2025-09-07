-- Add character limits for reflection fields in JSON
-- Run this migration in your Supabase SQL editor

-- Add check constraints for reflection field lengths
ALTER TABLE weeks 
ADD CONSTRAINT check_reflection_proud_length 
CHECK (
  (reflections IS NULL) OR 
  (jsonb_typeof(reflections) != 'object') OR
  (
    SELECT bool_and(
      (value->'proud' IS NULL) OR 
      (length(value->>'proud') <= 500)
    )
    FROM jsonb_each(reflections) AS t(key, value)
  )
);

ALTER TABLE weeks 
ADD CONSTRAINT check_reflection_improvements_length 
CHECK (
  (reflections IS NULL) OR 
  (jsonb_typeof(reflections) != 'object') OR
  (
    SELECT bool_and(
      (value->'improvements' IS NULL) OR 
      (length(value->>'improvements') <= 500)
    )
    FROM jsonb_each(reflections) AS t(key, value)
  )
);

ALTER TABLE weeks 
ADD CONSTRAINT check_reflection_thought_length 
CHECK (
  (reflections IS NULL) OR 
  (jsonb_typeof(reflections) != 'object') OR
  (
    SELECT bool_and(
      (value->'thought' IS NULL) OR 
      (length(value->>'thought') <= 1000)
    )
    FROM jsonb_each(reflections) AS t(key, value)
  )
);

ALTER TABLE weeks 
ADD CONSTRAINT check_reflection_mood_length 
CHECK (
  (reflections IS NULL) OR 
  (jsonb_typeof(reflections) != 'object') OR
  (
    SELECT bool_and(
      (value->'mood' IS NULL) OR 
      (length(value->>'mood') <= 50)
    )
    FROM jsonb_each(reflections) AS t(key, value)
  )
);

-- Test the constraints (optional)
-- This should succeed:
-- INSERT INTO weeks (user_id, week_start, reflections) 
-- VALUES (auth.uid(), '2024-01-01', '{"2024-01-01": {"proud": "Short text", "thought": "Another short text"}}');

-- This should fail:
-- INSERT INTO weeks (user_id, week_start, reflections) 
-- VALUES (auth.uid(), '2024-01-02', '{"2024-01-02": {"proud": "' || repeat('x', 501) || '"}}');