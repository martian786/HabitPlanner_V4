# Offline Backup Implementation Plan

## Problem
Users can lose calendar data if network drops while editing, especially when:
- Network connection is lost
- User closes tab/browser before data saves
- Browser crashes
- Server is temporarily unavailable

## Current Protection ✅
- UPSERT (doesn't overwrite, only updates sent fields)
- Retry logic (3 attempts with exponential backoff)
- Error messages to user
- Debounced autosave

## What's NOT protected ❌
- Data in memory is lost if user closes tab during network outage
- No offline queue for failed saves
- No recovery mechanism after page refresh

---

## Recommended Solution: localStorage Backup (Option A - Non-intrusive)

### Why localStorage?
- ✅ Built into browser (no dependencies)
- ✅ Synchronous API (simple to use)
- ✅ ~5-10MB storage (plenty for calendar data)
- ✅ Doesn't interfere with existing save logic
- ✅ Acts as safety net only

### Alternative: Dexie/IndexedDB
- Requires dependency: `npm install dexie`
- Async API (more complex)
- Larger storage (~50MB+)
- Overkill for simple backup needs

---

## Implementation Plan

### 1. Backup on Save Failure

**Location:** `src/App.tsx` - `saveWeek()` function

```typescript
async function saveWeek(weekISO: string): Promise<boolean> {
  const weekData = {
    week_start: weekISO,
    schedule,
    plan_name: planName,
    reflections,
  };

  try {
    const success = await dataService.saveWeek(weekData);

    if (success) {
      // Success - remove any backup
      localStorage.removeItem(`week-backup-${weekISO}`);

      // Update last saved state
      lastSavedDataRef.current = {
        schedule: JSON.parse(JSON.stringify(schedule)),
        plan_name: planName,
        reflections: JSON.parse(JSON.stringify(reflections))
      };
    }

    return success;
  } catch (error) {
    // Network failure - backup to localStorage
    console.log('💾 Save failed, backing up to localStorage');
    try {
      localStorage.setItem(
        `week-backup-${weekISO}`,
        JSON.stringify({
          weekData,
          timestamp: Date.now(),
          userId: user?.id
        })
      );
    } catch (storageError) {
      console.error('Failed to backup to localStorage:', storageError);
    }

    // Still throw error to show user
    throw error;
  }
}
```

### 2. Restore on App Load

**Location:** `src/App.tsx` - After user authentication

```typescript
// Check for localStorage backups on mount
useEffect(() => {
  if (!user?.id) return;

  const checkForBackups = () => {
    const backupKeys = Object.keys(localStorage).filter(key =>
      key.startsWith('week-backup-')
    );

    if (backupKeys.length > 0) {
      console.log(`Found ${backupKeys.length} backup(s) in localStorage`);

      backupKeys.forEach(key => {
        try {
          const backup = JSON.parse(localStorage.getItem(key) || '{}');

          // Verify it's for current user
          if (backup.userId !== user.id) {
            localStorage.removeItem(key);
            return;
          }

          // Check if backup is recent (< 24 hours old)
          const age = Date.now() - backup.timestamp;
          if (age > 24 * 60 * 60 * 1000) {
            console.log('Backup too old, removing');
            localStorage.removeItem(key);
            return;
          }

          // Show restore prompt to user
          const weekISO = key.replace('week-backup-', '');
          flash(`Unsaved changes found for week ${weekISO}. Attempting to restore...`);

          // Attempt to sync backup to server
          syncBackupToServer(weekISO, backup.weekData);
        } catch (err) {
          console.error('Failed to restore backup:', err);
          localStorage.removeItem(key);
        }
      });
    }
  };

  // Check for backups after initial load
  const timer = setTimeout(checkForBackups, 2000);
  return () => clearTimeout(timer);
}, [user?.id]);
```

### 3. Sync Backup to Server

```typescript
async function syncBackupToServer(weekISO: string, weekData: any) {
  try {
    console.log(`🔄 Syncing backup for week ${weekISO} to server`);
    const success = await dataService.saveWeek(weekData);

    if (success) {
      localStorage.removeItem(`week-backup-${weekISO}`);
      flash(`✅ Restored unsaved changes for week ${weekISO}`);
    }
  } catch (error) {
    console.error('Failed to sync backup:', error);
    flash(`⚠️ Could not restore changes for week ${weekISO}. Data kept in backup.`);
  }
}
```

### 4. Visual Indicator (Optional Enhancement)

```typescript
// Show "offline" badge when network is down
const [isOnline, setIsOnline] = useState(navigator.onLine);

useEffect(() => {
  const handleOnline = () => setIsOnline(true);
  const handleOffline = () => setIsOnline(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}, []);

// In UI
{!isOnline && (
  <div className="fixed top-2 right-2 bg-yellow-500 text-white px-3 py-1 rounded">
    ⚠️ Offline - changes saved locally
  </div>
)}
```

---

## Safety Guarantees

### What WON'T happen:
- ❌ Won't overwrite other weeks (each backup is keyed by week)
- ❌ Won't interfere with existing save flow (only activates on error)
- ❌ Won't corrupt data (UPSERT is still atomic)
- ❌ Won't cause conflicts (we validate user_id before restore)

### Edge Cases Handled:
1. **User switches accounts** - backups filtered by user_id
2. **Stale backups** - auto-remove after 24 hours
3. **localStorage full** - catch and log error, don't break save
4. **Multiple tabs** - each tab manages its own backups independently

---

## Testing Plan

### 1. Network Failure Test
```
1. Edit calendar
2. Disconnect network (Chrome DevTools → Network → Offline)
3. Trigger save (edit more)
4. Verify localStorage backup created
5. Reconnect network
6. Refresh page
7. Verify backup syncs to server
8. Verify backup removed from localStorage
```

### 2. Browser Crash Simulation
```
1. Edit calendar
2. Force close browser (don't close tab gracefully)
3. Reopen browser
4. Verify restore prompt appears
5. Verify data syncs to server
```

### 3. Multi-week Test
```
1. Edit week 1 → disconnect → backup created
2. Navigate to week 2 → edit → disconnect → backup created
3. Refresh page
4. Verify both weeks restore independently
```

---

## Storage Estimates

**Per week backup:**
- Schedule data: ~5-10 KB
- Plan name: ~100 bytes
- Reflections: ~1-2 KB
- Metadata: ~100 bytes
- **Total: ~6-12 KB per week**

**localStorage capacity:** ~5-10 MB

**Max weeks storable:** ~500-800 weeks (well beyond user needs)

---

## Implementation Priority

**Phase 1 (Essential):**
- ✅ Backup on save failure
- ✅ Restore on app load
- ✅ Auto-sync when network returns

**Phase 2 (Nice-to-have):**
- Visual offline indicator
- Manual "restore from backup" button
- Background sync retry queue

**Phase 3 (Future):**
- Service Worker for true offline support
- Background Sync API integration
- Progressive Web App (PWA) conversion

---

## Files to Modify

1. **src/App.tsx**
   - `saveWeek()` function - add backup on error
   - Add backup check useEffect after auth
   - Add `syncBackupToServer()` helper

2. **src/lib/dataService.ts**
   - No changes needed (this is why Option A is safe!)

3. **(Optional) src/components/OfflineIndicator.tsx**
   - New component for visual indicator

---

## Deployment Notes

- ✅ No database migrations needed
- ✅ No breaking changes
- ✅ Can be deployed incrementally
- ✅ Backward compatible (old versions ignore backups)
- ✅ Can be feature-flagged for gradual rollout

---

## Alternative Considered: Option B (Full Offline Mode)

**Why we didn't choose this:**
- More complex (requires rewriting save logic)
- Could conflict with UPSERT logic
- Risk of data conflicts between tabs
- Requires more testing
- Not needed for the use case

**When to consider Option B:**
- If building a true offline-first PWA
- If users regularly work without internet
- If implementing collaborative editing

---

## Questions to Consider Before Implementation

1. **How long should backups be kept?**
   - Recommendation: 24 hours (stale after that)

2. **Should we notify users of backups?**
   - Yes - show toast: "Changes saved locally, will sync when online"

3. **What if localStorage is disabled/full?**
   - Log error, continue normally (graceful degradation)

4. **Multiple tabs editing same week?**
   - Last write wins (same as current behavior)
   - Could add conflict detection in Phase 2

5. **Should we backup preferences/objectives too?**
   - Phase 1: No (weeks only)
   - Phase 2: Consider it

---

## Success Metrics

After implementation, track:
- Number of backups created per day
- Number of successful restores
- localStorage errors (if any)
- User feedback on data loss incidents

**Expected outcome:** Zero data loss from network issues 🎯

---

## Notes from Implementation Discussion

- User concerned about save logic (lots of previous issues)
- **Option A chosen because it's non-intrusive**
- Only activates on network failure (doesn't change existing save flow)
- Acts as safety net, not primary storage
- UPSERT logic remains unchanged

**Status:** Ready to implement when prioritized
**Estimated effort:** 2-3 hours
**Risk level:** Low (isolated changes, graceful degradation)
