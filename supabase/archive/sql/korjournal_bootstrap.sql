-- Körjournal bootstrap: create table and missing columns if needed (idempotent)
-- Run this in Supabase SQL editor or via Supabase CLI.

-- Extensions (safe if already enabled)
create extension if not exists pgcrypto;

-- Base table
create table if not exists public.korjournal_trips (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id text null,
  date date not null,
  start_address text not null,
  end_address text not null,
  start_km int4 null,
  end_km int4 null,
  note text null,
  sales_person text null
);

-- Add any missing columns without touching existing data/constraints
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'korjournal_trips' and column_name = 'created_at'
  ) then
    execute 'alter table public.korjournal_trips add column created_at timestamptz not null default now()';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'korjournal_trips' and column_name = 'user_id'
  ) then
    execute 'alter table public.korjournal_trips add column user_id text null';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'korjournal_trips' and column_name = 'date'
  ) then
    execute 'alter table public.korjournal_trips add column date date';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'korjournal_trips' and column_name = 'start_address'
  ) then
    execute 'alter table public.korjournal_trips add column start_address text';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'korjournal_trips' and column_name = 'end_address'
  ) then
    execute 'alter table public.korjournal_trips add column end_address text';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'korjournal_trips' and column_name = 'start_km'
  ) then
    execute 'alter table public.korjournal_trips add column start_km int4';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'korjournal_trips' and column_name = 'end_km'
  ) then
    execute 'alter table public.korjournal_trips add column end_km int4';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'korjournal_trips' and column_name = 'note'
  ) then
    execute 'alter table public.korjournal_trips add column note text';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'korjournal_trips' and column_name = 'sales_person'
  ) then
    execute 'alter table public.korjournal_trips add column sales_person text';
  end if;
end $$;

-- Ensure km fields are nullable for draft/incomplete entries
alter table public.korjournal_trips alter column start_km drop not null;
alter table public.korjournal_trips alter column end_km drop not null;

-- Enable RLS (policies are optional and depend on your auth model)
alter table public.korjournal_trips enable row level security;

-- Policies: each user can only access own rows
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='korjournal_trips' and policyname='korjournal read own') then
    execute 'create policy "korjournal read own" on public.korjournal_trips for select using (auth.uid()::text = user_id)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='korjournal_trips' and policyname='korjournal write own') then
    execute 'create policy "korjournal write own" on public.korjournal_trips for insert with check (auth.uid()::text = user_id)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='korjournal_trips' and policyname='korjournal update own') then
    execute 'create policy "korjournal update own" on public.korjournal_trips for update using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='korjournal_trips' and policyname='korjournal delete own') then
    execute 'create policy "korjournal delete own" on public.korjournal_trips for delete using (auth.uid()::text = user_id)';
  end if;
end $$;
