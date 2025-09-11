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
