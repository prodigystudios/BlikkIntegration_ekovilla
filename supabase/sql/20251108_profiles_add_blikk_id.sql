-- Migration: Add Blikk user id mapping to profiles
-- Date: 2025-11-08

alter table if exists public.profiles
  add column if not exists blikk_id bigint; -- nullable until mapped

comment on column public.profiles.blikk_id is 'External Blikk user id for syncing time reports and tasks';

-- Ensure uniqueness when set (allow many NULLs)
create unique index if not exists profiles_blikk_id_unique
  on public.profiles (blikk_id)
  where blikk_id is not null;
