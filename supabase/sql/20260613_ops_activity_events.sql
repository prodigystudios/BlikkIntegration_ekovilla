-- Wave 7 — new CRM-first planning: activity log / audit trail (ops_activity_events).
--
-- An append-only record of every schedule change (who placed/moved/removed a job, edited crew,
-- notes or sent a confirmation) so planners can trace "who changed what, when". The old Blikk
-- planning kept this in planning_activity_events; this is the ops_* equivalent.
--
-- Written best-effort from the route handlers (a failed log never breaks the user's action), so
-- this table is the audit surface, not a source of truth the board reads. Insert-only: no UPDATE
-- or DELETE policy — events are immutable once written.
--
-- DEPLOY ORDER: run AFTER 20260611_planning_permissions.sql (RLS calls has_permission) and the
-- ops_* foundation. Run in the Supabase SQL editor. Idempotent.

create table if not exists public.ops_activity_events (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  -- The acting user. actor_name is a durable display snapshot (profiles are self-read-only, so the
  -- log can never re-read another planner's name) — mirrors how crew names are denormalised.
  actor_id      uuid references public.profiles(id) on delete set null,
  actor_name    text,
  -- Dotted action key, e.g. 'segment.create', 'crew.add', 'confirmation.send'.
  action        text not null,
  -- The kind of thing acted on: 'segment' | 'crew' | 'truck_crew' | 'day_note' | 'confirmation'.
  entity_type   text not null,
  entity_id     uuid,
  -- Convenience foreign-key-ish columns for filtering the log by job (work order) or placement.
  -- Not constrained: the referenced row may be deleted (the whole point of an audit trail).
  work_order_id uuid,
  segment_id    uuid,
  -- Human-readable Swedish one-liner shown in the activity modal (e.g. 'Placerade #5418 på Bil 2').
  summary       text,
  -- Structured payload for anything the summary can't carry (old/new values, dates, ids).
  details       jsonb not null default '{}'::jsonb
);

create index if not exists ops_activity_events_created_idx    on public.ops_activity_events (created_at desc);
create index if not exists ops_activity_events_work_order_idx on public.ops_activity_events (work_order_id);
create index if not exists ops_activity_events_actor_idx      on public.ops_activity_events (actor_id);

alter table public.ops_activity_events enable row level security;
grant select, insert on public.ops_activity_events to authenticated;

-- Anyone who can read the schedule can read its history.
drop policy if exists ops_activity_events_select on public.ops_activity_events;
create policy ops_activity_events_select on public.ops_activity_events
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

-- Only schedule writers can append, and only as themselves (actor_id = auth.uid()).
drop policy if exists ops_activity_events_insert on public.ops_activity_events;
create policy ops_activity_events_insert on public.ops_activity_events
  for insert to authenticated
  with check (actor_id = auth.uid() and public.has_permission('planning.schedule.write'));

-- Stream new events to an open activity modal (insert-only, so no replica identity needed).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ops_activity_events'
  ) then
    execute 'alter publication supabase_realtime add table public.ops_activity_events';
  end if;
end $$;
