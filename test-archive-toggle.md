# Test Archive Toggle Behavior

## Expected Default Behavior:
1. ✅ **Fresh user**: Archive button shows "Show Archive (0)" 
2. ✅ **After archiving an objective**: Button shows "Show Archive (1)"
3. ✅ **Click "Show Archive"**: Button changes to "Hide Archive (1)" and shows archived section
4. ✅ **Click "Hide Archive"**: Button changes to "Show Archive (1)" and hides archived section  
5. ✅ **Page refresh while archive hidden**: Button still shows "Show Archive (1)"
6. ✅ **Page refresh while archive shown**: Button shows "Hide Archive (1)" and archived section visible

## Test Steps:

### 1. Check Initial State
- [ ] Fresh page load shows "Show Archive (0)" 
- [ ] No archived objectives section visible

### 2. Archive an Objective  
- [ ] Archive any objective using trash button
- [ ] Button should show "Show Archive (1)"
- [ ] Objective disappears from main list
- [ ] No archived section visible yet

### 3. Test Show Archive
- [ ] Click "Show Archive (1)" button
- [ ] Button changes to "Hide Archive (1)"  
- [ ] Archived objectives section appears below
- [ ] Archived objective visible in gray section

### 4. Test Hide Archive
- [ ] Click "Hide Archive (1)" button
- [ ] Button changes to "Show Archive (1)"
- [ ] Archived objectives section disappears

### 5. Test Persistence (Critical)
- [ ] With archive showing, refresh page
- [ ] Button should show "Hide Archive (1)" 
- [ ] Archived section should be visible
- [ ] Click hide, then refresh
- [ ] Button should show "Show Archive (1)"
- [ ] Archived section should be hidden

## SQL to Check User Preferences:
```sql
SELECT show_archived, delete_mode FROM user_preferences WHERE user_id = auth.uid();
```

## Browser Console Logs to Watch:
- "Fetching user preferences for: [user-id]"
- "Updating user preferences: {show_archived: true/false}"
- "Successfully updated preferences"