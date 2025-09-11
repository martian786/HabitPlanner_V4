
-- Gives you a single row per user with the effective plan & flags (only active/trialing and not expired).
create or replace view public.user_entitlements as
select
  s.user_id,
  s.price_id,
  p.code as plan_code,
  p.name as plan_name,
  p.max_objectives,
  p.has_advanced_analytics,
  p.can_copy_weeks,
  p.can_export_json,
  p.priority_support,
  s.status,
  s.current_period_end
from public.subscriptions s
join public.plans p on p.price_id = s.price_id
where s.status in ('active','trialing') and s.current_period_end > now();

grant select on public.user_entitlements to anon, authenticated;
