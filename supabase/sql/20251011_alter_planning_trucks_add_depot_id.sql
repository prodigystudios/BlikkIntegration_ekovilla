-- Migration: add depot_id to planning_trucks to link truck to a depå
-- Date: 2025-10-11

alter table public.planning_trucks
  add column if not exists depot_id uuid references public.planning_depots(id) on delete set null;

create index if not exists planning_trucks_depot_id_idx on public.planning_trucks(depot_id);
