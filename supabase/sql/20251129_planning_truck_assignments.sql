-- Create time-bound crew assignments for trucks
create table if not exists public.planning_truck_assignments (
  id uuid primary key default gen_random_uuid(),
  truck_id text not null,
  start_day date not null,
  end_day date not null,
  team1_id uuid null,
  team2_id uuid null,
  team_member1_name text null,
  team_member2_name text null,
  created_at timestamptz not null default now(),
  created_by uuid null
);

-- Ensure sensible ranges
alter table public.planning_truck_assignments
  add constraint planning_truck_assignments_day_range_check
  check (end_day >= start_day);

-- Index for resolution lookups
create index if not exists planning_truck_assignments_truck_range_idx
  on public.planning_truck_assignments (truck_id, start_day, end_day);

-- Optional: prevent overlapping assignments per truck via exclusion (requires btree_gist)
-- create extension if not exists btree_gist;
-- alter table public.planning_truck_assignments
--   add constraint planning_truck_assignments_no_overlap
--   exclude using gist (
--     truck_id with =,
--     daterange(start_day, end_day, '[]') with &&
--   );
