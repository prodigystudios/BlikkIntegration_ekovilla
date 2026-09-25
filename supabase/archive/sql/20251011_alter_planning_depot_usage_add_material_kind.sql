-- Add material kind to depot usage ledger
alter table if exists public.planning_depot_usage
  add column if not exists material_kind text check (material_kind in ('Ekovilla','Vitull'));

create index if not exists planning_depot_usage_material_idx
  on public.planning_depot_usage(material_kind);
