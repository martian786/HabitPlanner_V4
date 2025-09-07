# Soft Delete Implementation

This document describes the soft delete functionality added to the My Time Palette application.

## Overview

The application now supports two modes for deleting objectives:
- **Soft Delete (Archive)**: Hides objectives from planning view but preserves all historical data and analytics
- **Hard Delete**: Permanently removes objectives and all associated schedule data

## Features Implemented

### 1. Database Schema Changes
- Added `archived` boolean field to objectives table (defaults to `false`)
- Added database index for performance on archived field queries

### 2. Settings Configuration
- Added "Delete objectives" setting in Settings panel with two options:
  - "Archive (keep data)" - soft delete mode
  - "Delete permanently" - hard delete mode

### 3. Objective Management
- Archived objectives are filtered out of the main objectives list
- Objective count excludes archived objectives
- Archive viewing functionality with restore capability

### 4. Archive Management
- "Show Archive" button in settings displays count of archived objectives
- Archived objectives list shows with restore (↺) button
- Confirmation dialogs explain data impact for both modes

### 5. Analytics Preservation
- Archived objectives' historical data remains in analytics
- Schedule entries for archived objectives are preserved
- Analytics component filters out archived objectives from current planning

## Database Migration

Run the following SQL in your Supabase SQL editor:

```sql
-- Add archived field to objectives table
ALTER TABLE objectives 
ADD COLUMN archived BOOLEAN DEFAULT FALSE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_objectives_archived 
ON objectives (user_id, archived) 
WHERE archived IS FALSE OR archived IS NULL;
```

## Usage

### For Users:
1. Go to Settings panel
2. Choose delete behavior: "Archive (keep data)" or "Delete permanently"
3. When deleting objectives, the chosen mode will be applied
4. Use "Show Archive" button to view and restore archived objectives

### For Developers:
- `Objective` type now includes `archived?: boolean` field
- `fetchObjectives(includeArchived)` function supports fetching archived objectives
- `confirmAndDeleteObjective()` respects the `settings.deleteMode` preference
- `restoreObjective()` function available for unarchiving

## Benefits

1. **Data Preservation**: Historical completion data is never lost with soft delete
2. **User Choice**: Users can choose their preferred deletion behavior
3. **Analytics Integrity**: Past performance data remains available for analysis
4. **Reversible Actions**: Archived objectives can be restored
5. **Backward Compatibility**: Existing code continues to work unchanged