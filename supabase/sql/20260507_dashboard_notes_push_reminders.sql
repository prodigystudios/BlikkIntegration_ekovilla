-- Dashboard note reminders + web push subscriptions

alter table public.dashboard_notes
  add column if not exists reminder_at timestamptz,
  add column if not exists reminder_sent_at timestamptz;

create index if not exists dashboard_notes_due_reminders_idx
  on public.dashboard_notes(reminder_at)
  where reminder_at is not null and reminder_sent_at is null and done = false;

create table if not exists public.dashboard_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text
);

create index if not exists dashboard_push_subscriptions_user_idx
  on public.dashboard_push_subscriptions(user_id, created_at desc);

alter table public.dashboard_push_subscriptions enable row level security;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dashboard_push_subscriptions_select_own') THEN
    DROP POLICY "dashboard_push_subscriptions_select_own" ON public.dashboard_push_subscriptions;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dashboard_push_subscriptions_modify_own') THEN
    DROP POLICY "dashboard_push_subscriptions_modify_own" ON public.dashboard_push_subscriptions;
  END IF;
END$$;

create policy "dashboard_push_subscriptions_select_own" on public.dashboard_push_subscriptions
  for select using (auth.uid() = user_id);

create policy "dashboard_push_subscriptions_modify_own" on public.dashboard_push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists set_timestamp_dashboard_push_subscriptions on public.dashboard_push_subscriptions;
create trigger set_timestamp_dashboard_push_subscriptions
before update on public.dashboard_push_subscriptions
for each row execute procedure public.set_timestamp();