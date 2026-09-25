-- Create table for planner day notes
create table if not exists public.planning_day_notes (
  id uuid primary key default gen_random_uuid(),
  note_day date not null,
  text text not null,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now()
);

-- Index for faster lookups by day
create index if not exists idx_planning_day_notes_day on public.planning_day_notes(note_day);


 alter table public.planning_day_notes enable row level security;
 create policy "read notes" on public.planning_day_notes for select using (true);
 create policy "insert notes" on public.planning_day_notes for insert with check (true);
 create policy "update notes" on public.planning_day_notes for update using (true) with check (true);
 create policy "delete notes" on public.planning_day_notes for delete using (true);

-- Ensure the table is included in the Realtime publication
do $$ begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'planning_day_notes';
  if not found then
    execute 'alter publication supabase_realtime add table public.planning_day_notes';
  end if;
end $$;

-- Ensure DELETE events include old row data for Realtime
alter table public.planning_day_notes replica identity full;
