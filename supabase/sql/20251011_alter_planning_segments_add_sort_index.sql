-- Add explicit order field to planning_segments to control execution order per truck/day
alter table if exists public.planning_segments
  add column if not exists sort_index int;

create index if not exists planning_segments_sort_index_idx on public.planning_segments(sort_index);
