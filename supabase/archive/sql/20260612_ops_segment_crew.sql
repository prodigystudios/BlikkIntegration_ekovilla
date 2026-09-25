-- Wave 7 — new CRM-first planning: per-segment crew (besättning/team).
--
-- Who is going out on a scheduled job. One row per crew member on an ops_segment. The member's
-- name is DENORMALISED here (member_name) because profiles SELECT RLS is self-only — the planner
-- cannot read other people's profile rows, so we snapshot the display name at assign time and never
-- need to join profiles to render the board. member_id stays (nullable) for future "my jobs" /
-- installer linking; on profile deletion it nulls out but the name survives.
--
-- DEPLOY ORDER: run AFTER 20260611_ops_planning_foundation.sql (FK → ops_segments) and
-- 20260611_planning_permissions.sql (RLS predicates call has_permission('planning.*')).
-- Run in the Supabase SQL editor. Idempotent.

create table if not exists public.ops_segment_crew (
  id          uuid primary key default gen_random_uuid(),
  segment_id  uuid not null references public.ops_segments(id) on delete cascade,
  member_id   uuid references public.profiles(id) on delete set null,
  member_name text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists ops_segment_crew_segment_idx on public.ops_segment_crew (segment_id);
-- A given person can't be added to the same segment twice (freetext-only rows are unconstrained).
create unique index if not exists ops_segment_crew_member_uniq
  on public.ops_segment_crew (segment_id, member_id) where member_id is not null;

alter table public.ops_segment_crew enable row level security;
grant select, insert, update, delete on public.ops_segment_crew to authenticated;

drop policy if exists ops_segment_crew_select on public.ops_segment_crew;
create policy ops_segment_crew_select on public.ops_segment_crew
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

drop policy if exists ops_segment_crew_insert on public.ops_segment_crew;
create policy ops_segment_crew_insert on public.ops_segment_crew
  for insert to authenticated
  with check (created_by = auth.uid() and public.has_permission('planning.schedule.write'));

drop policy if exists ops_segment_crew_update on public.ops_segment_crew;
create policy ops_segment_crew_update on public.ops_segment_crew
  for update to authenticated
  using (public.has_permission('planning.schedule.write'))
  with check (public.has_permission('planning.schedule.write'));

drop policy if exists ops_segment_crew_delete on public.ops_segment_crew;
create policy ops_segment_crew_delete on public.ops_segment_crew
  for delete to authenticated
  using (public.has_permission('planning.schedule.write'));
