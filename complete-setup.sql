-- Subscriptions
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  price_id text not null,                        -- Stripe price id
  status text not null,                          -- trialing / active / past_due / canceled / incomplete / paused
  current_period_end timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);

-- Row Level Security
alter table public.subscriptions enable row level security;
create policy "users can read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);
-- Instead of a complex “entitlements” table, keep a tiny plans lookup keyed by Stripe price ID. This drives feature flags & limits without hard-coding them in the app.

create table if not exists public.plans (
  price_id text primary key,           -- Stripe price id
  code text not null,                  -- 'pro' | 'plus'
  name text not null,
  max_objectives int,                  -- null => unlimited
  has_advanced_analytics boolean not null default false,
  can_copy_weeks boolean not null default false,
  can_export_json boolean not null default false,
  priority_support boolean not null default false
);

-- seed your two plans
insert into public.plans (price_id, code, name, max_objectives, has_advanced_analytics, can_copy_weeks, can_export_json, priority_support)
values
  ('price_1S6ApKA34RVghX8xdm7fWO9O','pro','Habit Pro',5,true,false,false,false)
on conflict (price_id) do update set
  code=excluded.code, name=excluded.name, max_objectives=excluded.max_objectives,
  has_advanced_analytics=excluded.has_advanced_analytics, can_copy_weeks=excluded.can_copy_weeks,
  can_export_json=excluded.can_export_json, priority_support=excluded.priority_support;

insert into public.plans (price_id, code, name, max_objectives, has_advanced_analytics, can_copy_weeks, can_export_json, priority_support)
values
  ('price_1S6AqCA34RVghX8xnE0e3E7p','plus','Habit Plus',null,true,true,true,true)
on conflict (price_id) do update set
  code=excluded.code, name=excluded.name, max_objectives=excluded.max_objectives,
  has_advanced_analytics=excluded.has_advanced_analytics, can_copy_weeks=excluded.can_copy_weeks,
  can_export_json=excluded.can_export_json, priority_support=excluded.priority_support;

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
