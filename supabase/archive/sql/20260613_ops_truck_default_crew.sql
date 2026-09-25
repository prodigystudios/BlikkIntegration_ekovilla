-- Wave 7 — new CRM-first planning: default crew per truck (standardbemanning).
--
-- A truck's standing team (one teamledare + personal). The board shows it on every week's lane by
-- default; a week only gets explicit ops_truck_crew rows when it DEVIATES (then those win). This is
-- the baseline the old planning kept as planning_trucks.team_member1/2 — modelled here as its own
-- table so a team can have a leader + several members. member_name is denormalised (profiles SELECT
-- RLS is self-only), same as ops_truck_crew / ops_segment_crew.
--
-- Also adds a `role` to ops_truck_crew so that when a week is "forked" from the default, the leader
-- designation carries over.
--
-- DEPLOY ORDER: run AFTER 20260612_ops_truck_crew.sql. Run in the Supabase SQL editor. Idempotent.

-- ── role on weekly crew (carries the leader designation when a week forks from default) ──────────
alter table public.ops_truck_crew
  add column if not exists role text not null default 'member';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ops_truck_crew_role_check') then
    alter table public.ops_truck_crew add constraint ops_truck_crew_role_check check (role in ('leader', 'member'));
  end if;
end $$;

-- ── default crew per truck ───────────────────────────────────────────────────────────────────────
create table if not exists public.ops_truck_default_crew (
  id          uuid primary key default gen_random_uuid(),
  truck_id    uuid not null references public.ops_trucks(id) on delete cascade,
  member_id   uuid references public.profiles(id) on delete set null,
  member_name text not null,
  role        text not null default 'member',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint ops_truck_default_crew_role_check check (role in ('leader', 'member'))
);

create index if not exists ops_truck_default_crew_truck_idx on public.ops_truck_default_crew (truck_id);
-- A person appears at most once in a truck's standing team.
create unique index if not exists ops_truck_default_crew_member_uniq
  on public.ops_truck_default_crew (truck_id, member_id) where member_id is not null;
-- At most one leader per truck.
create unique index if not exists ops_truck_default_crew_leader_uniq
  on public.ops_truck_default_crew (truck_id) where role = 'leader';

alter table public.ops_truck_default_crew enable row level security;
grant select, insert, update, delete on public.ops_truck_default_crew to authenticated;

drop policy if exists ops_truck_default_crew_select on public.ops_truck_default_crew;
create policy ops_truck_default_crew_select on public.ops_truck_default_crew
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

drop policy if exists ops_truck_default_crew_insert on public.ops_truck_default_crew;
create policy ops_truck_default_crew_insert on public.ops_truck_default_crew
  for insert to authenticated
  with check (created_by = auth.uid() and public.has_permission('planning.schedule.write'));

drop policy if exists ops_truck_default_crew_update on public.ops_truck_default_crew;
create policy ops_truck_default_crew_update on public.ops_truck_default_crew
  for update to authenticated
  using (public.has_permission('planning.schedule.write'))
  with check (public.has_permission('planning.schedule.write'));

drop policy if exists ops_truck_default_crew_delete on public.ops_truck_default_crew;
create policy ops_truck_default_crew_delete on public.ops_truck_default_crew
  for delete to authenticated
  using (public.has_permission('planning.schedule.write'));

-- Stream changes so the board reflects edits to the standing team live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ops_truck_default_crew'
  ) then
    execute 'alter publication supabase_realtime add table public.ops_truck_default_crew';
  end if;
  execute 'alter table public.ops_truck_default_crew replica identity full';
end $$;
