-- Partial bag reporting per segment/day
create table if not exists public.planning_segment_reports (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.planning_segments(id) on delete cascade,
  report_day date not null,
  amount int not null check (amount > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists planning_segment_reports_segment_idx on public.planning_segment_reports(segment_id);
create index if not exists planning_segment_reports_day_idx on public.planning_segment_reports(report_day);

alter table public.planning_segment_reports enable row level security;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'planning_segment_reports_select') THEN
    DROP POLICY "planning_segment_reports_select" ON public.planning_segment_reports;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'planning_segment_reports_write') THEN
    DROP POLICY "planning_segment_reports_write" ON public.planning_segment_reports;
  END IF;
END$$;

create policy "planning_segment_reports_select" on public.planning_segment_reports for select using ( auth.role() = 'authenticated' );
create policy "planning_segment_reports_write"  on public.planning_segment_reports for all using ( auth.role() = 'authenticated' ) with check ( auth.role() = 'authenticated' );

create or replace function public.set_timestamp_planning_segment_reports()
returns trigger language plpgsql as $$ begin NEW.updated_at = now(); return NEW; end; $$;
create trigger planning_segment_reports_set_timestamp before update on public.planning_segment_reports for each row execute procedure public.set_timestamp_planning_segment_reports();

ALTER PUBLICATION supabase_realtime ADD TABLE public.planning_segment_reports;
