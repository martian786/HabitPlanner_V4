# Database Optimization Recommendations

## Required Database Indexes

For optimal performance of the secure, database-first architecture, implement these indexes in your Supabase database:

### 1. Objectives Table
```sql
-- Primary query patterns: user_id + archived status + sort_order
CREATE INDEX idx_objectives_user_active ON objectives (user_id, archived, sort_order) 
WHERE archived IS FALSE OR archived IS NULL;

-- For archived objectives queries
CREATE INDEX idx_objectives_user_archived ON objectives (user_id, sort_order) 
WHERE archived IS TRUE;

-- Unique constraint for active objectives only (prevents duplicate names)
CREATE UNIQUE INDEX unique_user_objective_name_active 
ON objectives (user_id, name) 
WHERE archived IS FALSE OR archived IS NULL;
```

### 2. User Preferences Table
```sql
-- Simple lookup by user_id (likely already has primary key)
CREATE INDEX idx_user_preferences_user_id ON user_preferences (user_id);
```

### 3. Weeks Table
```sql
-- Primary query pattern: user_id + week_start for loading weekly data
CREATE UNIQUE INDEX idx_weeks_user_week ON weeks (user_id, week_start);

-- For analytics queries by date range
CREATE INDEX idx_weeks_user_date_range ON weeks (user_id, week_start, updated_at);
```

## Row Level Security (RLS) Policies

Ensure these RLS policies are enabled for security:

```sql
-- Enable RLS on all tables
ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE weeks ENABLE ROW LEVEL SECURITY;

-- Objectives policies
CREATE POLICY "Users can manage their own objectives" ON objectives
FOR ALL USING (auth.uid() = user_id);

-- User preferences policies  
CREATE POLICY "Users can manage their own preferences" ON user_preferences
FOR ALL USING (auth.uid() = user_id);

-- Weeks policies
CREATE POLICY "Users can manage their own weeks" ON weeks
FOR ALL USING (auth.uid() = user_id);
```

## Performance Monitoring

Monitor these queries for performance:

1. **Objective Loading**: `SELECT * FROM objectives WHERE user_id = ? AND (archived IS FALSE OR archived IS NULL)`
2. **Week Loading**: `SELECT * FROM weeks WHERE user_id = ? AND week_start = ?`
3. **Preference Loading**: `SELECT * FROM user_preferences WHERE user_id = ?`

## Database Maintenance

### Recommended Settings
```sql
-- Ensure VACUUM and ANALYZE run regularly
-- (Supabase handles this automatically)

-- Monitor table sizes
SELECT 
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats 
WHERE tablename IN ('objectives', 'weeks', 'user_preferences');
```

### Archive Cleanup (Optional)
If you accumulate many archived objectives, consider periodic cleanup:

```sql
-- Clean up archived objectives older than 2 years
DELETE FROM objectives 
WHERE archived = true 
  AND updated_at < NOW() - INTERVAL '2 years';
```

## Real-time Subscriptions

The current implementation uses these Supabase real-time subscriptions:

1. **Objectives Changes**: `objectives` table filtered by `user_id`
2. **Preferences Changes**: `user_preferences` table filtered by `user_id`

These are efficient as they only send changes for the authenticated user.

## Performance Benefits

With these optimizations, you should see:

- **Query Performance**: Sub-100ms response times for all data loading
- **Real-time Updates**: Immediate sync across browser tabs/devices
- **Security**: Complete data isolation between users
- **Scalability**: Efficient queries even with thousands of users
- **Reliability**: No more localStorage data loss issues

## Monitoring Queries

Use these queries to monitor performance:

```sql
-- Check index usage
SELECT 
  indexrelname,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes 
WHERE schemaname = 'public';

-- Check slow queries
SELECT 
  query,
  mean_time,
  calls
FROM pg_stat_statements 
WHERE query LIKE '%objectives%' OR query LIKE '%weeks%'
ORDER BY mean_time DESC;
```