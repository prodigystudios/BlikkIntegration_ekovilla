-- Add per-segment truck assignment
alter table if exists public.planning_segments
  add column if not exists truck text null;

-- Backfill from project meta (one-time best effort)
update public.planning_segments s
set truck = m.truck
from public.planning_project_meta m
where m.project_id = s.project_id
  and s.truck is null;

-- Index to speed filters/sorts by truck
create index if not exists planning_segments_truck_idx on public.planning_segments (truck);
