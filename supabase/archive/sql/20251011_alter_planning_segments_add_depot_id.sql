-- Add optional depot reference to planning_segments for per-segment overrides
alter table if exists public.planning_segments
  add column if not exists depot_id uuid references public.planning_depots(id) on delete set null;

create index if not exists planning_segments_depot_id_idx on public.planning_segments(depot_id);
