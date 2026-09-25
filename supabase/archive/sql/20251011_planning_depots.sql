-- Migration: planning_depots table for loading sites (depåer)
-- Date: 2025-10-11

create extension if not exists pgcrypto;

create table if not exists public.planning_depots (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  material_total integer, -- total amount of material (e.g., säckar)
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.planning_depots enable row level security;

-- Select: all authenticated users can read
drop policy if exists planning_depots_select on public.planning_depots;
create policy planning_depots_select on public.planning_depots
  for select using (auth.role() = 'authenticated');

-- Insert/Update/Delete: only admins can modify
drop policy if exists planning_depots_admin_mod on public.planning_depots;
create policy planning_depots_admin_mod on public.planning_depots
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Realtime publication
alter publication supabase_realtime add table public.planning_depots;

-- Seed common depåer (idempotent)
insert into public.planning_depots (name, material_total)
values
  ('Rosersberg', null),
  ('Södertälje', null),
  ('Borlänge', null),
  ('Sandviken(Sågen)', null),
  ('Sandviken(kontor och lager)', null)
on conflict (name) do nothing;
