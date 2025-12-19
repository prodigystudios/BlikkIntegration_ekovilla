-- Planning activity log: captures who changed what and when
-- Tables observed: planning_segments, planning_project_meta, planning_truck_assignments
-- Realtime-enabled for client-side streaming

-- 1) Table
create table if not exists public.planning_activity_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid null,
  actor_name text null,
  action text not null, -- e.g. segment_created, segment_updated, segment_deleted, segment_moved, meta_updated, assignment_updated
  entity_type text not null, -- segment | project_meta | truck_assignment
  entity_id text not null, -- row id or composite
  project_id text null,
  segment_id uuid null,
  details jsonb null -- {changed: {field: {old, new}}, context: {...}}
);

comment on table public.planning_activity_events is 'Audit/activity log for planning changes';

create index if not exists planning_activity_events_project_idx on public.planning_activity_events(project_id);
create index if not exists planning_activity_events_segment_idx on public.planning_activity_events(segment_id);
create index if not exists planning_activity_events_created_idx on public.planning_activity_events(created_at desc);

-- 2) Helper to extract current user from JWT claims (Supabase)
create or replace function public.current_actor()
returns table (actor_id uuid, actor_name text) language plpgsql stable as $$
declare
  v_sub text;
  v_name text;
  v_actor_id uuid;
  v_actor_name text;
begin
  v_sub := nullif((current_setting('request.jwt.claims', true)::json ->> 'sub')::text, '');
  v_name := nullif((current_setting('request.jwt.claims', true)::json ->> 'full_name')::text, '');
  if v_sub is not null then v_actor_id := v_sub::uuid; else v_actor_id := null; end if;
  v_actor_name := v_name;
  if v_actor_name is null and v_actor_id is not null then
    begin
      select nullif(full_name, '') into v_actor_name from public.profiles where id = v_actor_id;
    exception when undefined_table then
      -- profiles table not available; ignore
      v_actor_name := null;
    end;
  end if;
  return query select v_actor_id, v_actor_name;
end; $$;

-- 3) Generic logger
create or replace function public.log_planning_activity(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_project_id text,
  p_segment_id uuid,
  p_details jsonb
) returns void language plpgsql as $$
declare
  a_id uuid;
  a_name text;
begin
  -- Mark context so RLS insert policy allows this write
  perform set_config('app.log_allowed', '1', true);
  select actor_id, actor_name into a_id, a_name from public.current_actor();
  insert into public.planning_activity_events (action, entity_type, entity_id, project_id, segment_id, details, actor_id, actor_name)
  values (p_action, p_entity_type, p_entity_id, p_project_id, p_segment_id, p_details, a_id, a_name);
end; $$;

-- 4) Diff builder for row changes
create or replace function public.json_diff(old_row jsonb, new_row jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k,
    jsonb_build_object('old', old_row->k, 'new', new_row->k)
  ), '{}'::jsonb)
  from (
    select key as k
    from (
      select jsonb_object_keys(old_row) key
      union
      select jsonb_object_keys(new_row) key
    ) u
  ) keys
  where (old_row->>k) is distinct from (new_row->>k)
$$;

-- 5) Triggers on planning_segments
create or replace function public.trg_planning_segments_log()
returns trigger language plpgsql as $$
declare
  changed jsonb;
  moved boolean := false;
  entity_id text;
  proj_id text;
  det jsonb;
begin
  if tg_op = 'INSERT' then
    entity_id := coalesce(new.id::text, '');
    proj_id := new.project_id::text;
    det := jsonb_build_object('new', to_jsonb(new) - 'updated_at', 'context', jsonb_build_object('truck', new.truck, 'start_day', new.start_day, 'end_day', new.end_day));
    perform public.log_planning_activity('segment_created', 'segment', entity_id, proj_id, new.id, det);
    return new;
  elsif tg_op = 'UPDATE' then
    entity_id := coalesce(new.id::text, old.id::text);
    proj_id := coalesce(new.project_id::text, old.project_id::text);
    changed := public.json_diff(to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
        moved := (old.start_day  is distinct from new.start_day)
          or (old.end_day    is distinct from new.end_day)
          or (old.truck      is distinct from new.truck)
          or (old.depot_id   is distinct from new.depot_id)
          or (old.job_type   is distinct from new.job_type)
          or (old.sort_index is distinct from new.sort_index);
    det := jsonb_build_object('changed', changed, 'context', jsonb_build_object(
      'truck_before', old.truck, 'truck_after', new.truck,
      'start_before', old.start_day, 'start_after', new.start_day,
      'end_before', old.end_day, 'end_after', new.end_day,
      'depot_before', old.depot_id, 'depot_after', new.depot_id,
      'job_type_before', old.job_type, 'job_type_after', new.job_type,
      'sort_index_before', old.sort_index, 'sort_index_after', new.sort_index
    ));
    perform public.log_planning_activity(case when moved then 'segment_moved' else 'segment_updated' end, 'segment', entity_id, proj_id, new.id, det);
    return new;
  elsif tg_op = 'DELETE' then
    entity_id := coalesce(old.id::text, '');
    proj_id := old.project_id::text;
    det := jsonb_build_object('old', to_jsonb(old) - 'updated_at');
    perform public.log_planning_activity('segment_deleted', 'segment', entity_id, proj_id, old.id, det);
    return old;
  end if;
  return null;
end; $$;

drop trigger if exists trg_planning_segments_log on public.planning_segments;
create trigger trg_planning_segments_log
after insert or update or delete on public.planning_segments
for each row execute function public.trg_planning_segments_log();

-- 6) Triggers on planning_project_meta (track key status changes, truck, bag counts)
create or replace function public.trg_planning_meta_log()
returns trigger language plpgsql as $$
declare
  entity_id text;
  proj_id text;
  changed jsonb;
  det jsonb;
begin
  if tg_op = 'UPDATE' then
    entity_id := coalesce(new.project_id::text, old.project_id::text);
    proj_id := entity_id;
    changed := public.json_diff(to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
    det := jsonb_build_object('changed', changed);
    perform public.log_planning_activity('meta_updated', 'project_meta', entity_id, proj_id, null, det);
    return new;
  elsif tg_op = 'INSERT' then
    entity_id := new.project_id::text;
    det := jsonb_build_object('new', to_jsonb(new) - 'updated_at');
    perform public.log_planning_activity('meta_created', 'project_meta', entity_id, new.project_id::text, null, det);
    return new;
  elsif tg_op = 'DELETE' then
    entity_id := old.project_id::text;
    det := jsonb_build_object('old', to_jsonb(old) - 'updated_at');
    perform public.log_planning_activity('meta_deleted', 'project_meta', entity_id, old.project_id::text, null, det);
    return old;
  end if;
  return null;
end; $$;

drop trigger if exists trg_planning_meta_log on public.planning_project_meta;
create trigger trg_planning_meta_log
after insert or update or delete on public.planning_project_meta
for each row execute function public.trg_planning_meta_log();

-- 7) Trigger function for planning_truck_assignments (defined unconditionally)
create or replace function public.trg_planning_assignments_log()
returns trigger language plpgsql as $$
declare
  entity_id text;
  det jsonb;
begin
  if tg_op = 'INSERT' then
    entity_id := new.id::text;
    det := jsonb_build_object('new', to_jsonb(new));
    perform public.log_planning_activity('assignment_created', 'truck_assignment', entity_id, null, null, det);
    return new;
  elsif tg_op = 'UPDATE' then
    entity_id := coalesce(new.id::text, old.id::text);
    det := jsonb_build_object('changed', public.json_diff(to_jsonb(old), to_jsonb(new)));
    perform public.log_planning_activity('assignment_updated', 'truck_assignment', entity_id, null, null, det);
    return new;
  elsif tg_op = 'DELETE' then
    entity_id := old.id::text;
    det := jsonb_build_object('old', to_jsonb(old));
    perform public.log_planning_activity('assignment_deleted', 'truck_assignment', entity_id, null, null, det);
    return old;
  end if;
  return null;
end; $$;

-- Create trigger only if table exists
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='planning_truck_assignments') then
    drop trigger if exists trg_planning_assignments_log on public.planning_truck_assignments;
    create trigger trg_planning_assignments_log
    after insert or update or delete on public.planning_truck_assignments
    for each row execute function public.trg_planning_assignments_log();
  end if;
end $$;

-- 8) RLS & publication
alter table public.planning_activity_events enable row level security;

-- Allow authenticated users to read; writes only via triggers
drop policy if exists planning_activity_events_select on public.planning_activity_events;
create policy planning_activity_events_select on public.planning_activity_events
  for select using (auth.role() = 'authenticated');

-- Allow inserts only when our trigger/logger sets a special GUC flag
drop policy if exists planning_activity_events_insert on public.planning_activity_events;
create policy planning_activity_events_insert on public.planning_activity_events
  for insert
  with check (
    auth.role() = 'authenticated'
    and current_setting('app.log_allowed', true) = '1'
  );

-- Realtime publication (idempotent)
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'planning_activity_events'
  ) then
    alter publication supabase_realtime add table public.planning_activity_events;
  end if;
end $$;
