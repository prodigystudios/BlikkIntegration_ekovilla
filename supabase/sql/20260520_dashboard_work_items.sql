-- Unified personal dashboard work items for notes and meetings.

create table if not exists public.dashboard_work_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'note' check (kind in ('note', 'meeting')),
  title text not null,
  body text,
  status text not null default 'active' check (status in ('active', 'done', 'cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  due_at timestamptz,
  remind_at timestamptz,
  reminder_sent_at timestamptz,
  location text,
  link_url text,
  related_type text,
  related_id text,
  metadata jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dashboard_work_items_user_status_kind_idx
  on public.dashboard_work_items(user_id, status, kind, created_at desc);

create index if not exists dashboard_work_items_user_starts_at_idx
  on public.dashboard_work_items(user_id, starts_at asc)
  where starts_at is not null;

create index if not exists dashboard_work_items_user_remind_at_idx
  on public.dashboard_work_items(user_id, remind_at asc)
  where remind_at is not null and reminder_sent_at is null and status = 'active';

alter table public.dashboard_work_items enable row level security;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dashboard_work_items_select_own') THEN
    DROP POLICY "dashboard_work_items_select_own" ON public.dashboard_work_items;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dashboard_work_items_modify_own') THEN
    DROP POLICY "dashboard_work_items_modify_own" ON public.dashboard_work_items;
  END IF;
END$$;

create policy "dashboard_work_items_select_own" on public.dashboard_work_items
  for select using (auth.uid() = user_id);

create policy "dashboard_work_items_modify_own" on public.dashboard_work_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists set_timestamp_dashboard_work_items on public.dashboard_work_items;
create trigger set_timestamp_dashboard_work_items
before update on public.dashboard_work_items
for each row execute procedure public.set_timestamp();

insert into public.dashboard_work_items (
  id,
  user_id,
  kind,
  title,
  body,
  status,
  remind_at,
  reminder_sent_at,
  completed_at,
  created_at,
  updated_at
)
select
  dn.id,
  dn.user_id,
  'note',
  dn.text,
  null,
  case when dn.done then 'done' else 'active' end,
  dn.reminder_at,
  dn.reminder_sent_at,
  case when dn.done then dn.updated_at else null end,
  dn.created_at,
  dn.updated_at
from public.dashboard_notes dn
on conflict (id) do nothing;

do $$
begin
  perform 1
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'dashboard_work_items';
  if not found then
    execute 'alter publication supabase_realtime add table public.dashboard_work_items';
  end if;
end $$;

alter table public.dashboard_work_items replica identity full;