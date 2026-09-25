-- Dashboard notes storage
-- Creates table dashboard_notes with RLS so each user
-- can manage their own personal notes across devices.

create table if not exists public.dashboard_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dashboard_notes_user_id_created_idx on public.dashboard_notes(user_id, created_at desc);

alter table public.dashboard_notes enable row level security;

-- Policies (recreate safe) - drop existing if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dashboard_notes_select_own') THEN
    DROP POLICY "dashboard_notes_select_own" ON public.dashboard_notes;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dashboard_notes_modify_own') THEN
    DROP POLICY "dashboard_notes_modify_own" ON public.dashboard_notes;
  END IF;
END$$;

create policy "dashboard_notes_select_own" on public.dashboard_notes
  for select using ( auth.uid() = user_id );

create policy "dashboard_notes_modify_own" on public.dashboard_notes
  for all using ( auth.uid() = user_id ) with check ( auth.uid() = user_id );

-- Updated timestamp trigger
create or replace function public.set_timestamp()
returns trigger language plpgsql as $$
begin
  NEW.updated_at = now();
  return NEW;
end;$$;

drop trigger if exists set_timestamp_dashboard_notes on public.dashboard_notes;
create trigger set_timestamp_dashboard_notes
before update on public.dashboard_notes
for each row execute procedure public.set_timestamp();

-- Optional helper view for current user's notes (ordered)
create or replace view public.current_user_dashboard_notes as
  select id, text, done, created_at, updated_at
  from public.dashboard_notes
  where user_id = auth.uid()
  order by created_at desc;

-- Ensure table is part of realtime publication (idempotent)
ALTER PUBLICATION supabase_realtime ADD TABLE public.dashboard_notes;
