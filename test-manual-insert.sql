-- Test manual subscription insert for debugging
INSERT INTO public.subscriptions (
  user_id,
  stripe_customer_id,
  stripe_subscription_id,
  price_id,
  status,
  current_period_end
) VALUES (
  '89352809-c3e3-4370-8c9e-338e1ac9c347',
  'cus_T2Nd7XGqJ1H4s9',
  'sub_1S6IscA34RVghX8xD3lDZxrs',
  'price_1S6ApKA34RVghX8xdm7fWO9O',
  'active',
  '2025-09-11 23:02:14+00'
);

-- Check if insert worked
SELECT * FROM public.subscriptions 
WHERE user_id = '89352809-c3e3-4370-8c9e-338e1ac9c347';

-- Check entitlements view
SELECT * FROM public.user_entitlements 
WHERE user_id = '89352809-c3e3-4370-8c9e-338e1ac9c347';