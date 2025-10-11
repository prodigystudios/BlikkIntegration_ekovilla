-- View and function to fetch current user's jobs based on truck team membership
create or replace view public.user_my_jobs_v as
select
  s.id as segment_id,
  s.project_id,
  s.project_name,
  s.customer,
  s.order_number,
  s.start_day,
  s.end_day,
  m.truck,
  m.job_type,
  m.bag_count
from public.planning_segments s
left join public.planning_project_meta m on m.project_id = s.project_id
left join public.planning_trucks t on t.name = m.truck
where t.team1_id is not null or t.team2_id is not null;

-- Secure function that filters by auth.uid() and optional date bounds
create or replace function public.get_my_jobs(start_date date default null, end_date date default null)
returns setof public.user_my_jobs_v
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.user_my_jobs_v
  where (start_date is null or start_day >= start_date)
    and (end_date is null or end_day <= end_date)
    and exists (
      select 1
      from public.planning_project_meta m2
      join public.planning_trucks t2 on t2.name = m2.truck
      where m2.project_id = user_my_jobs_v.project_id
        and (t2.team1_id = auth.uid() or t2.team2_id = auth.uid())
    );
$$;

revoke all on function public.get_my_jobs(date, date) from public;
grant execute on function public.get_my_jobs(date, date) to authenticated;
