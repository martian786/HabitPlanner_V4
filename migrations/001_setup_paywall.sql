-- Complete paywall database setup
-- This creates all necessary tables, views, and data for the paywall system

-- 1. Create subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON public.subscriptions(user_id);

-- Row Level Security
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own subscription" ON public.subscriptions;
CREATE POLICY "users can read own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- 2. Create plans table
CREATE TABLE IF NOT EXISTS public.plans (
  price_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  max_objectives INT,
  has_advanced_analytics BOOLEAN NOT NULL DEFAULT FALSE,
  can_copy_weeks BOOLEAN NOT NULL DEFAULT FALSE,
  can_export_json BOOLEAN NOT NULL DEFAULT FALSE,
  priority_support BOOLEAN NOT NULL DEFAULT FALSE
);

-- Grant access to plans table
GRANT SELECT ON public.plans TO anon, authenticated;

-- 3. Seed plans data
INSERT INTO public.plans (price_id, code, name, max_objectives, has_advanced_analytics, can_copy_weeks, can_export_json, priority_support)
VALUES
  ('price_1S6ApKA34RVghX8xdm7fWO9O','pro','Habit Pro',5,true,false,false,false)
ON CONFLICT (price_id) DO UPDATE SET
  code=EXCLUDED.code, name=EXCLUDED.name, max_objectives=EXCLUDED.max_objectives,
  has_advanced_analytics=EXCLUDED.has_advanced_analytics, can_copy_weeks=EXCLUDED.can_copy_weeks,
  can_export_json=EXCLUDED.can_export_json, priority_support=EXCLUDED.priority_support;

INSERT INTO public.plans (price_id, code, name, max_objectives, has_advanced_analytics, can_copy_weeks, can_export_json, priority_support)
VALUES
  ('price_1S6AqCA34RVghX8xnE0e3E7p','plus','Habit Plus',null,true,true,true,true)
ON CONFLICT (price_id) DO UPDATE SET
  code=EXCLUDED.code, name=EXCLUDED.name, max_objectives=EXCLUDED.max_objectives,
  has_advanced_analytics=EXCLUDED.has_advanced_analytics, can_copy_weeks=EXCLUDED.can_copy_weeks,
  can_export_json=EXCLUDED.can_export_json, priority_support=EXCLUDED.priority_support;

-- 4. Create user_entitlements view
CREATE OR REPLACE VIEW public.user_entitlements AS
SELECT
  s.user_id,
  s.price_id,
  p.code AS plan_code,
  p.name AS plan_name,
  p.max_objectives,
  p.has_advanced_analytics,
  p.can_copy_weeks,
  p.can_export_json,
  p.priority_support,
  s.status,
  s.current_period_end
FROM public.subscriptions s
JOIN public.plans p ON p.price_id = s.price_id
WHERE s.status IN ('active','trialing') AND s.current_period_end > now();

GRANT SELECT ON public.user_entitlements TO anon, authenticated;