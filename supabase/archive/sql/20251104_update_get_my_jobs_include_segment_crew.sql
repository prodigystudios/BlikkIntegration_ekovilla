-- Update get_my_jobs to include per-segment extra crew members
-- Date: 2025-11-04

-- This widens membership so that a user sees jobs if:
-- - They are on the truck team (team1_id/team2_id) for the truck assigned to the segment or project, OR
-- - They were added as an extra member for that segment in planning_segment_team_members

create or replace function public.get_my_jobs(start_date date default null, end_date date default null)
returns setof public.user_my_jobs_v
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select auth.uid() as id
  )
  select *
  from public.user_my_jobs_v v
  where (start_date is null or v.job_day >= start_date)
    and (end_date is null or v.job_day <= end_date)
    and (
      exists (
        select 1
        from public.planning_trucks t2
        where t2.name = v.truck
          and (t2.team1_id = (select id from me) or t2.team2_id = (select id from me))
      )
      or exists (
        select 1
        from public.planning_segment_team_members stm
        where stm.segment_id = v.segment_id
          and (
            stm.member_id = (select id from me)
            -- Optional name fallback: uncomment if you want to match on full name too (may cause false positives if names collide)
            -- or (stm.member_id is null and stm.member_name in (select full_name from public.profiles where id = (select id from me)))
          )
      )
    );
$$;

revoke all on function public.get_my_jobs(date, date) from public;
grant execute on function public.get_my_jobs(date, date) to authenticated;
