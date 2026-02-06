-- Add on-hold / paused state for planning segments
-- Date: 2026-02-06

-- 1) Add columns
alter table if exists public.planning_segments
  add column if not exists on_hold boolean not null default false,
  add column if not exists on_hold_at timestamptz,
  add column if not exists on_hold_by uuid;

create index if not exists planning_segments_on_hold_idx on public.planning_segments(on_hold);

-- 2) Exclude on-hold segments from My Jobs view
-- This ensures paused jobs do not appear in drivers' schedules / dashboards.
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
left join lateral generate_series(s.start_day, s.end_day, interval '1 day') as gs(d) on true
left join public.planning_trucks t on t.name = coalesce(s.truck, m.truck)
where t.name is not null
  and coalesce(s.on_hold, false) = false;
