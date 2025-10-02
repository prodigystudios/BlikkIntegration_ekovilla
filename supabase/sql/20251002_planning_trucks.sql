-- Migration: planning_trucks table for dynamic trucks and team assignment
-- Date: 2025-10-02

create extension if not exists pgcrypto;

create table if not exists public.planning_trucks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text,
  team_member1_name text,
  team_member2_name text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.planning_trucks enable row level security;

-- Select: all authenticated users
-- Policy: select for all authenticated users (idempotent)
drop policy if exists planning_trucks_select on public.planning_trucks;
create policy planning_trucks_select on public.planning_trucks
  for select using (auth.role() = 'authenticated');

-- Insert/Update/Delete: only admins
-- Policy: insert/update/delete only for admins (idempotent)
drop policy if exists planning_trucks_admin_mod on public.planning_trucks;
create policy planning_trucks_admin_mod on public.planning_trucks
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Realtime publication
alter publication supabase_realtime add table public.planning_trucks;
