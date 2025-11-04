-- Per-segment crew assignments (extra members for the day)
-- Date: 2025-11-04

create table if not exists public.planning_segment_team_members (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.planning_segments(id) on delete cascade,
  member_id uuid null references public.profiles(id) on delete set null,
  member_name text not null,
  created_at timestamp with time zone not null default now()
);

create index if not exists planning_segment_team_members_segment_idx
  on public.planning_segment_team_members (segment_id);
