-- Add address fields to planning_project_meta for faster calendar rendering
-- Date: 2025-11-03

alter table public.planning_project_meta
  add column if not exists address_street text,
  add column if not exists address_postal text,
  add column if not exists address_city text;

-- Optional simple index to filter by address presence (not strictly necessary)
create index if not exists planning_project_meta_address_city_idx on public.planning_project_meta (address_city);
