-- Wave 7 — new CRM-first planning: editable job types (jobbtyper + färg).
--
-- Job types were a hardcoded set; this makes them admin-editable. ops_segments.job_type still stores
-- the stable `key`; label + colour are resolved from here. Reading is board-level
-- (planning.schedule.read, for the card chip + the picker); managing reuses planning.truck.manage
-- (the planning-admin gate, admin-only). Seeded with the original six.
--
-- DEPLOY ORDER: run AFTER 20260611_planning_permissions.sql. Run in the Supabase SQL editor.
-- Idempotent.

create table if not exists public.ops_job_types (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label      text not null,
  color      text not null,
  sort_index integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.ops_job_types enable row level security;
grant select, insert, update, delete on public.ops_job_types to authenticated;

drop policy if exists ops_job_types_select on public.ops_job_types;
create policy ops_job_types_select on public.ops_job_types
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

drop policy if exists ops_job_types_insert on public.ops_job_types;
create policy ops_job_types_insert on public.ops_job_types
  for insert to authenticated
  with check (public.has_permission('planning.truck.manage'));

drop policy if exists ops_job_types_update on public.ops_job_types;
create policy ops_job_types_update on public.ops_job_types
  for update to authenticated
  using (public.has_permission('planning.truck.manage'))
  with check (public.has_permission('planning.truck.manage'));

drop policy if exists ops_job_types_delete on public.ops_job_types;
create policy ops_job_types_delete on public.ops_job_types
  for delete to authenticated
  using (public.has_permission('planning.truck.manage'));

-- Seed the original set (keys match the values already stored on ops_segments.job_type).
insert into public.ops_job_types (key, label, color, sort_index) values
  ('ekovilla',   'Ekovilla',   '#059669', 0),
  ('vitull',     'Vitull',     '#0284c7', 1),
  ('leverans',   'Leverans',   '#0d9488', 2),
  ('utsugning',  'Utsugning',  '#d97706', 3),
  ('snickerier', 'Snickerier', '#7c3aed', 4),
  ('ovrigt',     'Övrigt',     '#64748b', 5)
on conflict (key) do nothing;
