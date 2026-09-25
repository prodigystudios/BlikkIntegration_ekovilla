-- Track depot material usage from egenkontroll reports
create table if not exists public.planning_depot_usage (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  installation_date date,
  depot_id uuid not null references public.planning_depots(id) on delete cascade,
  bags_used int not null check (bags_used > 0),
  source_key text, -- optional idempotency key (e.g. archive path)
  created_at timestamptz not null default now()
);

create index if not exists planning_depot_usage_project_idx on public.planning_depot_usage(project_id);
create index if not exists planning_depot_usage_depot_idx on public.planning_depot_usage(depot_id);
create index if not exists planning_depot_usage_date_idx on public.planning_depot_usage(installation_date);

-- Ensure idempotency if same report_key is processed again
do $$ begin
  if not exists (
    select 1 from pg_indexes where schemaname='public' and indexname='planning_depot_usage_source_key_unique'
  ) then
    create unique index planning_depot_usage_source_key_unique on public.planning_depot_usage(source_key) where source_key is not null;
  end if;
end $$;

alter table public.planning_depot_usage enable row level security;
create policy planning_depot_usage_read on public.planning_depot_usage for select using ( auth.role() = 'authenticated' );
-- For INSERT policies, only WITH CHECK is allowed (no USING clause)
create policy planning_depot_usage_insert on public.planning_depot_usage for insert with check ( auth.role() = 'authenticated' );

-- Add to realtime if desired (optional)
alter publication supabase_realtime add table public.planning_depot_usage;
