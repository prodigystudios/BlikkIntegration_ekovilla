-- planning_depot_deliveries: planned inbound deliveries to depots
create table if not exists public.planning_depot_deliveries (
  id uuid primary key default gen_random_uuid(),
  depot_id uuid not null references public.planning_depots(id) on delete cascade,
  material_kind text not null check (material_kind in ('Ekovilla','Vitull')),
  amount integer not null check (amount > 0),
  delivery_date date not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- simple index for querying upcoming deliveries per depot/date
create index if not exists idx_planning_depot_deliveries_depot_date
  on public.planning_depot_deliveries(depot_id, delivery_date);

comment on table public.planning_depot_deliveries is 'Planned deliveries to depots (material, amount, date).';

-- Ensure uuid generator available (idempotent)
create extension if not exists pgcrypto;

-- Enable RLS and align policies with repo patterns
alter table public.planning_depot_deliveries enable row level security;

-- Read: all authenticated users
drop policy if exists planning_depot_deliveries_select on public.planning_depot_deliveries;
create policy planning_depot_deliveries_select
  on public.planning_depot_deliveries
  for select
  using (auth.role() = 'authenticated');

-- Write: only admins (profiles.role = 'admin')
drop policy if exists planning_depot_deliveries_admin_mod on public.planning_depot_deliveries;
create policy planning_depot_deliveries_admin_mod
  on public.planning_depot_deliveries
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Realtime publication
alter publication supabase_realtime add table public.planning_depot_deliveries;