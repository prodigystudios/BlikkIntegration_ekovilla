-- Cache tables for Blikk reference data (timecodes & activities)
-- Created: 2025-11-09

create table if not exists public.blikk_timecodes (
  id text primary key,              -- stable identifier (stringified)
  code text,
  name text,
  billable boolean,
  active boolean,
  source jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists blikk_timecodes_code_idx on public.blikk_timecodes (code);
create index if not exists blikk_timecodes_name_lower_idx on public.blikk_timecodes ((lower(name)));
create index if not exists blikk_timecodes_updated_at_idx on public.blikk_timecodes (updated_at desc);

create table if not exists public.blikk_activities (
  id text primary key,
  code text,
  name text,
  billable boolean,
  active boolean,
  source jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists blikk_activities_code_idx on public.blikk_activities (code);
create index if not exists blikk_activities_name_lower_idx on public.blikk_activities ((lower(name)));
create index if not exists blikk_activities_updated_at_idx on public.blikk_activities (updated_at desc);

comment on table public.blikk_timecodes is 'Cached Blikk timecodes for fast UI access. Refreshed periodically.';
comment on table public.blikk_activities is 'Cached Blikk activities for fast UI access. Refreshed periodically.';
