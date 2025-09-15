-- Create account_preferences table
CREATE TABLE account_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email_reminders BOOLEAN DEFAULT true,
    weekly_reports BOOLEAN DEFAULT false,
    security_alerts BOOLEAN DEFAULT true,
    show_percentages BOOLEAN DEFAULT true,
    compact_view BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create unique index on user_id to ensure one preference record per user
CREATE UNIQUE INDEX account_preferences_user_id_idx ON account_preferences(user_id);

-- Enable RLS (Row Level Security)
ALTER TABLE account_preferences ENABLE ROW LEVEL SECURITY;

-- Create RLS policy - users can only access their own preferences
CREATE POLICY "Users can access their own account preferences" ON account_preferences
    FOR ALL USING (auth.uid() = user_id);

-- Create function to automatically update updated_at timestamp (if not already exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_account_preferences_updated_at
    BEFORE UPDATE ON account_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to initialize account preferences when a user signs up
CREATE OR REPLACE FUNCTION create_account_preferences()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO account_preferences (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically create preferences when user signs up
CREATE TRIGGER create_account_preferences_trigger
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_account_preferences();