-- Migration: planning_job_type_colors for per-job type/material display colors
-- Date: 2025-11-01

create table if not exists public.planning_job_type_colors (
  job_type text primary key,
  color_hex text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.planning_job_type_colors enable row level security;

-- Select: all authenticated users can read
drop policy if exists planning_job_type_colors_select on public.planning_job_type_colors;
create policy planning_job_type_colors_select on public.planning_job_type_colors
  for select using (auth.role() = 'authenticated');

-- Insert/Update/Delete: only admins can modify
drop policy if exists planning_job_type_colors_admin_mod on public.planning_job_type_colors;
create policy planning_job_type_colors_admin_mod on public.planning_job_type_colors
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Update trigger to maintain updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at_planning_job_type_colors on public.planning_job_type_colors;
create trigger set_updated_at_planning_job_type_colors
before update on public.planning_job_type_colors
for each row execute function public.set_updated_at();

-- Realtime publication
alter publication supabase_realtime add table public.planning_job_type_colors;

-- Seed common job types/materials (idempotent)
insert into public.planning_job_type_colors (job_type, color_hex)
values
  ('Ekovilla', '#0ea5e9'),
  ('Vitull', '#1d4ed8'),
  ('Leverans', '#16a34a'),
  ('Utsugning', '#dc2626'),
  ('Snickerier', '#7c3aed'),
  ('Övrigt', '#6b7280')
on conflict (job_type) do nothing;
