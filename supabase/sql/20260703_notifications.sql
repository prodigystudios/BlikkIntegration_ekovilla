-- Generic in-app notification center (first notification system in the app).
--
-- One row = one notification delivered to one user. Deliberately generic (type + entity_type/
-- entity_id + href) so future features can reuse it, not just felanmälan. The bell in the app
-- shell reads the caller's own rows (RLS) and streams new ones over Realtime.
--
-- Writes fan out server-side: a user never inserts a notification for ANOTHER user, so there is
-- no INSERT policy — the fan-out routes use the service-role client (getSupabaseAdmin()). Users
-- may only SELECT and UPDATE (mark-as-read) their own rows.
--
-- Run in the Supabase SQL editor. Idempotent.

create table if not exists public.notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  -- Dotted type key, e.g. 'fault_report.created' | 'fault_report.updated'.
  type              text not null,
  title             text not null,
  body              text,
  -- In-app link the row navigates to when clicked, e.g. '/felanmalan?arende=<id>'.
  href              text,
  -- What the notification is about, for grouping/filtering. entity_id is not FK-constrained
  -- (the referenced row may be deleted; the notification is a point-in-time message).
  entity_type       text,
  entity_id         uuid,
  read_at           timestamptz,               -- null = unread
  created_at        timestamptz not null default now()
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_user_id, created_at desc);

-- Fast unread count/badge: partial index over just the unread rows.
create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_user_id) where read_at is null;

alter table public.notifications enable row level security;

-- INSERT is service-role only (fan-out) → no insert grant/policy for authenticated.
grant select, update on public.notifications to authenticated;

-- Read only your own notifications.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (recipient_user_id = auth.uid());

-- Mark your own notifications read (UPDATE). A matching SELECT policy exists above, satisfying
-- the "UPDATE requires SELECT" rule. Row-scoped, not column-scoped — a user can only touch their
-- own rows; mark-as-read only ever sets read_at.
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- Stream INSERT (new notification) + UPDATE (read_at) to the open bell. replica identity full so
-- DELETE/UPDATE payloads carry the old row for client-side reconciliation.
alter table public.notifications replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;
