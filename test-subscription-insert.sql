-- Temporary test: manually insert a subscription for user to verify the flow works
-- User ID from logs: 6a0c3eff-7b23-484d-8f82-995baac6c1e5

-- First ensure tables exist
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- Insert plans
INSERT INTO public.plans (price_id, code, name, max_objectives, has_advanced_analytics, can_copy_weeks, can_export_json, priority_support)
VALUES
  ('price_1S6ApKA34RVghX8xdm7fWO9O','pro','Habit Pro',5,true,false,false,false),
  ('price_1S6AqCA34RVghX8xnE0e3E7p','plus','Habit Plus',null,true,true,true,true)
ON CONFLICT (price_id) DO NOTHING;

-- Create user_entitlements view
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

-- Test subscription for your user
INSERT INTO public.subscriptions (
  user_id, 
  stripe_customer_id, 
  stripe_subscription_id, 
  price_id, 
  status, 
  current_period_end
) VALUES (
  '6a0c3eff-7b23-484d-8f82-995baac6c1e5'::UUID,
  'cus_test_123',
  'sub_test_123', 
  'price_1S6ApKA34RVghX8xdm7fWO9O',
  'active',
  now() + INTERVAL '1 month'
) ON CONFLICT DO NOTHING;

-- Grant permissions
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT SELECT ON public.user_entitlements TO anon, authenticated;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "users can read own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);