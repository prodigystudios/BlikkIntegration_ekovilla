-- Wave 7 — new CRM-first planning: day notes (dagsanteckningar).
--
-- Free-text notes pinned to a calendar day on the board (e.g. "Anna ledig", "Bil 2 på service",
-- "Helgjobb möjligt"). Global per day (not truck-scoped) — the planner reads them as a strip under
-- each day column. Append-style: one row per note, add/remove individually.
--
-- DEPLOY ORDER: run AFTER 20260611_planning_permissions.sql (RLS predicates call
-- has_permission('planning.*')). Run in the Supabase SQL editor. Idempotent.

create table if not exists public.ops_day_notes (
  id         uuid primary key default gen_random_uuid(),
  note_day   date not null,
  body       text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ops_day_notes_day_idx on public.ops_day_notes (note_day);

alter table public.ops_day_notes enable row level security;
grant select, insert, update, delete on public.ops_day_notes to authenticated;

drop policy if exists ops_day_notes_select on public.ops_day_notes;
create policy ops_day_notes_select on public.ops_day_notes
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

drop policy if exists ops_day_notes_insert on public.ops_day_notes;
create policy ops_day_notes_insert on public.ops_day_notes
  for insert to authenticated
  with check (created_by = auth.uid() and public.has_permission('planning.schedule.write'));

drop policy if exists ops_day_notes_update on public.ops_day_notes;
create policy ops_day_notes_update on public.ops_day_notes
  for update to authenticated
  using (public.has_permission('planning.schedule.write'))
  with check (public.has_permission('planning.schedule.write'));

drop policy if exists ops_day_notes_delete on public.ops_day_notes;
create policy ops_day_notes_delete on public.ops_day_notes
  for delete to authenticated
  using (public.has_permission('planning.schedule.write'));
