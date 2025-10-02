-- Planning schedule persistence
-- Creates tables for calendar scheduling with realtime + shared org-wide access.

create table if not exists public.planning_segments (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  project_name text not null,
  customer text,
  order_number text,
  source text not null check (source in ('blikk','manual')),
  is_manual boolean not null default false,
  start_day date not null,
  end_day date not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists planning_segments_start_idx on public.planning_segments(start_day);
create index if not exists planning_segments_project_idx on public.planning_segments(project_id);

create table if not exists public.planning_project_meta (
  project_id text primary key,
  truck text,
  bag_count int,
  job_type text,
  color text,
  updated_at timestamptz not null default now()
);

alter table public.planning_segments enable row level security;
alter table public.planning_project_meta enable row level security;

-- Open read to all authenticated users; write allowed to all authenticated (adjust if you need stricter roles later)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'planning_segments_select') THEN
    DROP POLICY "planning_segments_select" ON public.planning_segments;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'planning_segments_write') THEN
    DROP POLICY "planning_segments_write" ON public.planning_segments;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'planning_project_meta_select') THEN
    DROP POLICY "planning_project_meta_select" ON public.planning_project_meta;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'planning_project_meta_write') THEN
    DROP POLICY "planning_project_meta_write" ON public.planning_project_meta;
  END IF;
END$$;

create policy "planning_segments_select" on public.planning_segments for select using ( auth.role() = 'authenticated' );
create policy "planning_segments_write"  on public.planning_segments for all using ( auth.role() = 'authenticated' ) with check ( auth.role() = 'authenticated' );

create policy "planning_project_meta_select" on public.planning_project_meta for select using ( auth.role() = 'authenticated' );
create policy "planning_project_meta_write"  on public.planning_project_meta for all using ( auth.role() = 'authenticated' ) with check ( auth.role() = 'authenticated' );

-- Updated timestamp triggers
create or replace function public.set_timestamp_planning_segments()
returns trigger language plpgsql as $$ begin NEW.updated_at = now(); return NEW; end; $$;
create or replace function public.set_timestamp_planning_meta()
returns trigger language plpgsql as $$ begin NEW.updated_at = now(); return NEW; end; $$;

create trigger planning_segments_set_timestamp before update on public.planning_segments for each row execute procedure public.set_timestamp_planning_segments();
create trigger planning_meta_set_timestamp before update on public.planning_project_meta for each row execute procedure public.set_timestamp_planning_meta();

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.planning_segments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.planning_project_meta;
