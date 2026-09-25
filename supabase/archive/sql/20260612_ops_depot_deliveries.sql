-- Wave 7 — new CRM-first planning: depot deliveries (leveranser), stock half (slice 12b).
--
-- Each row is a delivery of sacks of a given material into a depot (stock in). Per-material balance
-- = sum(deliveries) − consumption, where consumption is derived from ops_segment_reports (a job's
-- blown sacks → its segment's truck → that truck's depot, attributed to the work order's material).
-- The material string is the canonical `short` from lib/domains/crm/materials.ts (EKOVILLA, …) so
-- deliveries and consumption reconcile.
--
-- DEPLOY ORDER: run AFTER 20260612_ops_depots.sql (FK → ops_depots) and
-- 20260611_planning_permissions.sql. Run in the Supabase SQL editor. Idempotent.

create table if not exists public.ops_depot_deliveries (
  id           uuid primary key default gen_random_uuid(),
  depot_id     uuid not null references public.ops_depots(id) on delete cascade,
  material     text not null,
  sacks        integer not null check (sacks > 0),
  delivered_on date not null,
  note         text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists ops_depot_deliveries_depot_idx on public.ops_depot_deliveries (depot_id, material);

alter table public.ops_depot_deliveries enable row level security;
grant select, insert, update, delete on public.ops_depot_deliveries to authenticated;

drop policy if exists ops_depot_deliveries_select on public.ops_depot_deliveries;
create policy ops_depot_deliveries_select on public.ops_depot_deliveries
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

drop policy if exists ops_depot_deliveries_insert on public.ops_depot_deliveries;
create policy ops_depot_deliveries_insert on public.ops_depot_deliveries
  for insert to authenticated
  with check (created_by = auth.uid() and public.has_permission('planning.schedule.write'));

drop policy if exists ops_depot_deliveries_update on public.ops_depot_deliveries;
create policy ops_depot_deliveries_update on public.ops_depot_deliveries
  for update to authenticated
  using (public.has_permission('planning.schedule.write'))
  with check (public.has_permission('planning.schedule.write'));

drop policy if exists ops_depot_deliveries_delete on public.ops_depot_deliveries;
create policy ops_depot_deliveries_delete on public.ops_depot_deliveries
  for delete to authenticated
  using (public.has_permission('planning.schedule.write'));
