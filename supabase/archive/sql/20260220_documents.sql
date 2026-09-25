-- Documents / File system feature
-- Date: 2026-02-20

create extension if not exists pgcrypto;

-- Folders
create table if not exists public.documents_folders (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.documents_folders(id) on delete cascade,
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_folders_parent_idx on public.documents_folders(parent_id);

-- Enforce case-insensitive uniqueness within same parent (including root)
create unique index if not exists documents_folders_parent_name_uq
  on public.documents_folders ((coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)), (lower(name)));

alter table public.documents_folders enable row level security;

-- Files
create table if not exists public.documents_files (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.documents_folders(id) on delete cascade,
  file_name text not null,
  storage_bucket text not null,
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_files_folder_idx on public.documents_files(folder_id);
create unique index if not exists documents_files_folder_name_uq
  on public.documents_files ((coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid)), (lower(file_name)));

alter table public.documents_files enable row level security;

-- Read access: all authenticated users
drop policy if exists documents_folders_select on public.documents_folders;
create policy documents_folders_select on public.documents_folders
  for select using (auth.role() = 'authenticated');

drop policy if exists documents_files_select on public.documents_files;
create policy documents_files_select on public.documents_files
  for select using (auth.role() = 'authenticated');

-- Write access: only admins
drop policy if exists documents_folders_admin_write on public.documents_folders;
create policy documents_folders_admin_write on public.documents_folders
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists documents_files_admin_write on public.documents_files;
create policy documents_files_admin_write on public.documents_files
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
