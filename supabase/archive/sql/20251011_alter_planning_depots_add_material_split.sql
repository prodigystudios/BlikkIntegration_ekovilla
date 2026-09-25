-- Split depot stock into per-material columns
alter table if exists public.planning_depots
  add column if not exists material_ekovilla_total integer,
  add column if not exists material_vitull_total integer;

-- Backfill: assume existing material_total represented Ekovilla (adjust manually if needed)
update public.planning_depots
set material_ekovilla_total = coalesce(material_ekovilla_total, material_total)
where material_total is not null;

-- Keep legacy column for compatibility; can be dropped once UI fully migrated
-- alter table public.planning_depots drop column material_total;
