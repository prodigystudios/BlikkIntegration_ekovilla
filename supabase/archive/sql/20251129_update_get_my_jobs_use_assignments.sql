-- Update get_my_jobs to respect weekly truck crew assignments per day
-- Date: 2025-11-29

-- Assumptions:
-- - Table public.planning_truck_assignments(truck_id text, start_day date, end_day date,
--     team1_id uuid null, team2_id uuid null, team_member1_name text null, team_member2_name text null)
-- - View public.user_my_jobs_v emits job_day and truck name per row
-- - planning_trucks has name and optional team1_id/team2_id as static fallback

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
      -- 1) Membership via weekly assignment on the truck for that job_day
      exists (
        select 1
        from public.planning_truck_assignments a
        join public.planning_trucks t on t.name = v.truck and t.name = a.truck_id
        where v.job_day between a.start_day and a.end_day
          and (
            a.team1_id = (select id from me) or a.team2_id = (select id from me)
            or (
              -- Fallback: match on full name if IDs were not set in the assignment
              (a.team1_id is null and a.team_member1_name is not null and exists (
                select 1 from public.profiles p where p.id = (select id from me) and lower(p.full_name) = lower(a.team_member1_name)
              ))
              or (a.team2_id is null and a.team_member2_name is not null and exists (
                select 1 from public.profiles p where p.id = (select id from me) and lower(p.full_name) = lower(a.team_member2_name)
              ))
            )
          )
      )
      -- 2) OR membership via static truck team (fallback if no assignment applies)
      or exists (
        select 1
        from public.planning_trucks t2
        where t2.name = v.truck
          and (
            t2.team1_id = (select id from me) or t2.team2_id = (select id from me)
          )
      )
      -- 3) OR explicitly added as segment crew member
      or exists (
        select 1
        from public.planning_segment_team_members stm
        where stm.segment_id = v.segment_id
          and stm.member_id = (select id from me)
      )
    );
$$;

revoke all on function public.get_my_jobs(date, date) from public;
grant execute on function public.get_my_jobs(date, date) to authenticated;
