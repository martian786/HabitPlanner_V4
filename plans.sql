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
