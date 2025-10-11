-- Internal Tasks storage
-- This creates a shared tasks table with basic assignment and status handling.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'open', -- 'open' | 'done' (kept simple as text)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  due_date date,
  created_by uuid not null references auth.users(id) on delete cascade,
  assigned_to uuid not null references auth.users(id) on delete cascade,
  source text, -- e.g., 'clothing_order'
  metadata jsonb
);

create index if not exists tasks_assigned_status_idx on public.tasks(assigned_to, status);
create index if not exists tasks_created_at_idx on public.tasks(created_at desc);

alter table public.tasks enable row level security;

-- Drop old policies if they exist to keep idempotent
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tasks_select_assigned_or_created') THEN
    DROP POLICY "tasks_select_assigned_or_created" ON public.tasks;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tasks_insert_self_creator') THEN
    DROP POLICY "tasks_insert_self_creator" ON public.tasks;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tasks_update_assigned_or_created') THEN
    DROP POLICY "tasks_update_assigned_or_created" ON public.tasks;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tasks_delete_creator_only') THEN
    DROP POLICY "tasks_delete_creator_only" ON public.tasks;
  END IF;
END$$;

-- Read your own created tasks and those assigned to you
create policy "tasks_select_assigned_or_created" on public.tasks
  for select using ( auth.uid() = assigned_to or auth.uid() = created_by );

-- Allow any authenticated user to insert tasks, but enforce created_by = auth.uid()
create policy "tasks_insert_self_creator" on public.tasks
  for insert to authenticated
  with check ( created_by = auth.uid() );

-- Allow updates when you are creator or assignee; ensure row remains visible to you
create policy "tasks_update_assigned_or_created" on public.tasks
  for update using ( auth.uid() = assigned_to or auth.uid() = created_by )
  with check ( auth.uid() = assigned_to or auth.uid() = created_by );

-- Allow creators to delete their tasks
create policy "tasks_delete_creator_only" on public.tasks
  for delete using ( auth.uid() = created_by );

-- Updated timestamp trigger
create or replace function public.set_timestamp_tasks()
returns trigger language plpgsql as $$
begin
  NEW.updated_at = now();
  return NEW;
end;$$;

drop trigger if exists set_timestamp_tasks on public.tasks;
create trigger set_timestamp_tasks
before update on public.tasks
for each row execute procedure public.set_timestamp_tasks();

-- Publish in realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
