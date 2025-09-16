-- Run this to verify your paywall database setup is complete
-- Check what exists and what might be missing

-- Check if subscriptions table exists
SELECT 'subscriptions table' as component, 
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subscriptions') 
            THEN '✅ EXISTS' 
            ELSE '❌ MISSING' 
       END as status;

-- Check if plans table exists and has data
SELECT 'plans table' as component,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plans')
            THEN '✅ EXISTS'
            ELSE '❌ MISSING'
       END as status;

SELECT 'plans data' as component,
       CASE WHEN EXISTS (SELECT 1 FROM plans LIMIT 1)
            THEN '✅ HAS DATA (' || (SELECT COUNT(*) FROM plans)::text || ' plans)'
            ELSE '❌ EMPTY'
       END as status;

-- Check if user_entitlements view exists  
SELECT 'user_entitlements view' as component,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'user_entitlements')
            THEN '✅ EXISTS'
            ELSE '❌ MISSING'
       END as status;

-- Show current plans if they exist
SELECT 'Current plans:' as info, price_id, code, name FROM plans ORDER BY code;