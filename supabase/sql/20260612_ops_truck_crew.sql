-- Wave 7 — new CRM-first planning: weekly truck crew (besättning per bil / rotation).
--
-- Who crews a truck over a date range (typically a week). The board shows each truck's crew for the
-- visible week on its lane and lets the planner rotate it week to week. This is the truck's standing
-- team; a specific job can still carry its own extra crew (ops_segment_crew, slice 5). Like that
-- table, member_name is DENORMALISED because profiles SELECT RLS is self-only — the board renders
-- without joining profiles. member_id stays (nullable) for future linking.
--
-- DEPLOY ORDER: run AFTER 20260611_ops_planning_foundation.sql (FK → ops_trucks) and
-- 20260611_planning_permissions.sql. Run in the Supabase SQL editor. Idempotent.

create table if not exists public.ops_truck_crew (
  id          uuid primary key default gen_random_uuid(),
  truck_id    uuid not null references public.ops_trucks(id) on delete cascade,
  member_id   uuid references public.profiles(id) on delete set null,
  member_name text not null,
  start_day   date not null,
  end_day     date not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint ops_truck_crew_day_range_check check (end_day >= start_day)
);

create index if not exists ops_truck_crew_truck_range_idx on public.ops_truck_crew (truck_id, start_day, end_day);
-- A person can't be added to the same truck twice for the same period start (weekly key).
create unique index if not exists ops_truck_crew_member_uniq
  on public.ops_truck_crew (truck_id, member_id, start_day) where member_id is not null;

alter table public.ops_truck_crew enable row level security;
grant select, insert, update, delete on public.ops_truck_crew to authenticated;

drop policy if exists ops_truck_crew_select on public.ops_truck_crew;
create policy ops_truck_crew_select on public.ops_truck_crew
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

drop policy if exists ops_truck_crew_insert on public.ops_truck_crew;
create policy ops_truck_crew_insert on public.ops_truck_crew
  for insert to authenticated
  with check (created_by = auth.uid() and public.has_permission('planning.schedule.write'));

drop policy if exists ops_truck_crew_update on public.ops_truck_crew;
create policy ops_truck_crew_update on public.ops_truck_crew
  for update to authenticated
  using (public.has_permission('planning.schedule.write'))
  with check (public.has_permission('planning.schedule.write'));

drop policy if exists ops_truck_crew_delete on public.ops_truck_crew;
create policy ops_truck_crew_delete on public.ops_truck_crew
  for delete to authenticated
  using (public.has_permission('planning.schedule.write'));
