# Debug User Preferences Implementation

## Steps to Verify the Implementation

### 1. Run Verification SQL in Supabase
Copy and run the contents of `verify-migration.sql` in your Supabase SQL Editor to check:
- ✅ `archived` column exists in `objectives` table
- ✅ `user_preferences` table structure is correct
- ✅ Indexes were created
- ✅ RLS policies are set up

### 2. Check Browser Console Logs
Open your app and check the browser console (F12) for:
```
"Fetching user preferences for: [user-id]"
"Fetched objectives: [data]"
"Error fetching preferences:" (if any errors)
```

### 3. Expected Behavior After Fix
- ✅ "Show Archive" button should persist state across page refreshes
- ✅ Button text should stay in sync (Show/Hide Archive)
- ✅ Archive view preference saves to database
- ✅ Delete mode preference saves to database

### 4. Troubleshooting Common Issues

#### Issue: "Failed to load objectives"
- Check if `archived` column exists: `SELECT archived FROM objectives LIMIT 1;`
- If column missing, run the migration SQL

#### Issue: "Error fetching preferences"
- Check if `user_preferences` table exists: `SELECT * FROM user_preferences;`
- Check RLS policies are working: Try manual insert/select

#### Issue: Button out of sync after refresh
- Check browser console for preference loading logs
- Verify user is authenticated when fetching preferences

### 5. Manual Testing Steps
1. **Test Archive Toggle**:
   - Click "Show Archive" button
   - Refresh page → should still show "Hide Archive"
   - Click "Hide Archive" → should show "Show Archive"

2. **Test Delete Mode Persistence**:
   - Change delete mode in settings
   - Refresh page → should remember selection
   - Delete an objective → should use saved preference

3. **Test Cross-Device Sync** (if multiple devices):
   - Change preference on device 1
   - Open app on device 2 → should show same preference

### 6. Database Queries for Manual Verification

```sql
-- Check your current preferences
SELECT * FROM user_preferences WHERE user_id = auth.uid();

-- See all user preferences (admin view)
SELECT up.*, au.email 
FROM user_preferences up 
LEFT JOIN auth.users au ON up.user_id = au.id;

-- Check objectives with archived status
SELECT id, name, archived FROM objectives WHERE user_id = auth.uid();
```