-- Ensure all planner tables are included in the Realtime publication
do $$
declare
  t text;
  tables text[] := array[
    'planning_segments',
    'planning_segment_team_members',
    'planning_project_meta',
    'planning_segment_reports',
    'planning_trucks',
    'planning_depots',
    'planning_depot_deliveries',
    'planning_day_notes'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I.%I', 'public', t);
    end if;
  end loop;
end $$;

-- Ensure DELETE events include old row data across planner tables
do $$
declare
  t text;
  tables text[] := array[
    'planning_segments',
    'planning_segment_team_members',
    'planning_project_meta',
    'planning_segment_reports',
    'planning_trucks',
    'planning_depots',
    'planning_depot_deliveries',
    'planning_day_notes'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I.%I replica identity full', 'public', t);
  end loop;
end $$;
