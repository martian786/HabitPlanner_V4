create table public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  email text not null,
  plan text,
  page_url text,
  utm_source text,
  utm_campaign text,
  utm_medium text,
  first_click_plan text,
  ga_client_id text,
  user_agent text,
  ip inet,
  source text
);

-- Enable Row Level Security and restrict inserts to service role only
alter table public.leads enable row level security;
create policy "service-only-inserts"
on public.leads for insert
to service_role
with check (true);


--Make make email unique so on_conflict=email works
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_email_key'
  ) then
    alter table public.leads
      add constraint leads_email_key unique (email);
  end if;
end$$;

alter table public.leads
  add constraint leads_email_key unique (email);


---------------- GOOD to have for analysis ============

/*Daily signup*/

select date_trunc('day', created_at) as day, count(*) 
from public.leads
group by 1 order by 1 desc;

/* By plan*/
select coalesce(plan,'(none)') as plan, count(*) 
from public.leads
group by 1 order by 2 desc;

/* UTM Performance */
select utm_source, utm_campaign, count(*) 
from public.leads
group by 1,2 order by 3 desc;

/* Recent 50 */
select created_at, name, email, plan, source 
from public.leads
order by created_at desc
limit 50;



