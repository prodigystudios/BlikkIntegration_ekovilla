-- Migration: Per-day My Jobs with segment-level truck
-- - Adds planning_segments.truck (if missing)
-- - Replaces user_my_jobs_v to emit one row per job day (job_day)
-- - Updates get_my_jobs(start_date, end_date) to filter by overlap via job_day

-- 1) Ensure per-segment truck column exists
alter table if exists public.planning_segments
  add column if not exists truck text;

create index if not exists planning_segments_truck_idx on public.planning_segments(truck);

-- Best-effort backfill from project meta if segment truck is null
update public.planning_segments s
set truck = m.truck
from public.planning_project_meta m
where s.truck is null
  and m.project_id = s.project_id;

-- 2) Replace view to include one row per day and prefer segment truck
drop view if exists public.user_my_jobs_v cascade;

create or replace view public.user_my_jobs_v as
select
  s.id as segment_id,
  s.project_id,
  s.project_name,
  s.customer,
  s.order_number,
  s.start_day,
  s.end_day,
  (gs.d)::date as job_day,
  coalesce(s.truck, m.truck) as truck,
  m.job_type,
  m.bag_count
from public.planning_segments s
left join public.planning_project_meta m on m.project_id = s.project_id
-- expand one row per day in the segment span
left join lateral generate_series(s.start_day, s.end_day, interval '1 day') as gs(d) on true
-- keep only rows tied to some known truck entry (team membership filter is done in the function)
left join public.planning_trucks t on t.name = coalesce(s.truck, m.truck)
where t.name is not null;

-- 3) Update function to filter by auth user membership and job_day overlap
create or replace function public.get_my_jobs(start_date date default null, end_date date default null)
returns setof public.user_my_jobs_v
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.user_my_jobs_v v
  where (start_date is null or v.job_day >= start_date)
    and (end_date is null or v.job_day <= end_date)
    and exists (
      select 1
      from public.planning_trucks t2
      where t2.name = v.truck
        and (t2.team1_id = auth.uid() or t2.team2_id = auth.uid())
    );
$$;

revoke all on function public.get_my_jobs(date, date) from public;
grant execute on function public.get_my_jobs(date, date) to authenticated;
