-- Wave 7 — new CRM-first planning: enable Supabase Realtime on the ops_* tables.
--
-- ~10 people plan concurrently, so the board must reflect each other's placements/moves live to
-- avoid double-bookings + missed updates. PlanningClient subscribes to postgres_changes on these
-- tables and debounce-refetches the visible board when anyone changes them. RLS still applies, so
-- a subscriber only receives changes to rows they could SELECT (planning.schedule.read).
--
-- DEPLOY ORDER: run AFTER the ops_* tables exist (20260611/20260612 migrations). Idempotent.

do $$
declare
  t text;
  tables text[] := array[
    'ops_segments',
    'ops_segment_crew',
    'ops_truck_crew',
    'ops_day_notes',
    'ops_segment_reports',
    'ops_work_order_confirmations',
    'ops_trucks',
    'ops_depots',
    'ops_depot_deliveries',
    'ops_job_types'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I.%I', 'public', t);
    end if;
    -- DELETE events need the old row to be carried so subscribers know what disappeared.
    execute format('alter table %I.%I replica identity full', 'public', t);
  end loop;
end $$;
