-- Secure RLS setup for account_preferences

-- Remove the unsafe anon permission
REVOKE ALL ON account_preferences FROM anon;

-- Re-enable RLS
ALTER TABLE account_preferences ENABLE ROW LEVEL SECURITY;

-- Create a proper RLS policy that works
CREATE POLICY "Users can manage their own account preferences"
ON account_preferences
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);