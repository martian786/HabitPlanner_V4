-- Migration to set up paywall database with existing schema
-- Run this in your new Supabase project (qnkeqmisuynxchlkckvs) SQL editor

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create objectives table
CREATE TABLE IF NOT EXISTS public.objectives (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) <= 24),
  color text NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  archived boolean DEFAULT false,
  CONSTRAINT objectives_pkey PRIMARY KEY (id),
  CONSTRAINT objectives_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- Create user preferences table
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  show_archived boolean DEFAULT false,
  delete_mode text DEFAULT 'soft'::text CHECK (delete_mode = ANY (ARRAY['soft'::text, 'hard'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  start_minutes integer DEFAULT 360,
  end_minutes integer DEFAULT 1320,
  slot_minutes integer DEFAULT 20,
  week_starts_on text DEFAULT 'Monday'::text CHECK (week_starts_on = ANY (ARRAY['Monday'::text, 'Sunday'::text])),
  max_objectives integer DEFAULT 6 CHECK (max_objectives >= 1 AND max_objectives <= 20),
  tick_color text DEFAULT '#16a34a'::text,
  show_objective_names boolean DEFAULT true,
  prevent_overwrite boolean DEFAULT true,
  CONSTRAINT user_preferences_pkey PRIMARY KEY (id),
  CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- Create weeks table
CREATE TABLE IF NOT EXISTS public.weeks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  schedule jsonb DEFAULT '{}'::jsonb,
  plan_name text DEFAULT ''::text,
  reflections jsonb DEFAULT '{}'::jsonb,
  visible_objectives text[] DEFAULT ARRAY[]::text[],
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT weeks_pkey PRIMARY KEY (id),
  CONSTRAINT weeks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE weeks ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can manage their own objectives" ON objectives
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own preferences" ON user_preferences
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own weeks" ON weeks
    FOR ALL USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_objectives_user_id ON objectives(user_id);
CREATE INDEX IF NOT EXISTS idx_objectives_archived ON objectives (user_id, archived);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_weeks_user_id ON weeks(user_id);
CREATE INDEX IF NOT EXISTS idx_weeks_week_start ON weeks(user_id, week_start);