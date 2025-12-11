-- Migration: add per-segment job_type to allow varying work types per project

begin;

alter table if exists public.planning_segments add column if not exists job_type text;

-- Backfill from project meta for existing rows where segment job_type is missing
update public.planning_segments s
set job_type = m.job_type
from public.planning_project_meta m
where m.project_id = s.project_id
  and s.job_type is null;

-- Ensure delete events include old row data
alter table if exists public.planning_segments replica identity full;

commit;