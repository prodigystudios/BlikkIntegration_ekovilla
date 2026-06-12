-- Wave 7 — new CRM-first planning: depots (depåer), foundation half (slice 12a).
--
-- A depot is a physical store of insulation sacks. Each truck belongs to a depot (ops_trucks.depot_id);
-- deliveries (stock in) and per-material balances come in slice 12b. Reading depots is a board-level
-- read (planning.schedule.read) so lanes/pickers can show them; managing them is planning.depot.manage.
--
-- DEPLOY ORDER: run AFTER 20260611_ops_planning_foundation.sql (ALTER ops_trucks) and
-- 20260611_planning_permissions.sql. Run in the Supabase SQL editor. Idempotent.

create table if not exists public.ops_depots (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  location   text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.ops_depots enable row level security;
grant select, insert, update, delete on public.ops_depots to authenticated;

drop policy if exists ops_depots_select on public.ops_depots;
create policy ops_depots_select on public.ops_depots
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

drop policy if exists ops_depots_insert on public.ops_depots;
create policy ops_depots_insert on public.ops_depots
  for insert to authenticated
  with check (public.has_permission('planning.depot.manage'));

drop policy if exists ops_depots_update on public.ops_depots;
create policy ops_depots_update on public.ops_depots
  for update to authenticated
  using (public.has_permission('planning.depot.manage'))
  with check (public.has_permission('planning.depot.manage'));

drop policy if exists ops_depots_delete on public.ops_depots;
create policy ops_depots_delete on public.ops_depots
  for delete to authenticated
  using (public.has_permission('planning.depot.manage'));

-- Each truck belongs to a depot (nullable; nulls out if the depot is removed).
alter table public.ops_trucks add column if not exists depot_id uuid references public.ops_depots(id) on delete set null;
