-- Felanmälan (equipment fault reporting).
--
-- Any signed-in user files a report (category + free-text comment). A fixed, admin-managed list
-- of "arbetsledare" (fault_report_recipients) receives it — both as an in-app notification (see
-- 20260703_notifications.sql) and as an email (fan-out happens in the route handler). Supervisors
-- set status + write a reply; the reporter sees it on their ärende and gets an update notification.
--
-- There is no "arbetsledare" role in the app, so recipients are a data-managed set of user_ids.
-- A single user_id row gives both the id (in-app notification) and — via auth.admin.getUserById
-- server-side — the always-current email. is_fault_report_recipient() is the single source both
-- RLS and the route guard read (same pattern as has_permission()).
--
-- DEPLOY ORDER: run AFTER 20260703_notifications.sql. Run in the Supabase SQL editor. Idempotent.
-- After running, seed the supervisor(s) — see the seed block at the end.

-- ---------------------------------------------------------------------------
-- Recipients (arbetsledare) + membership helper
-- ---------------------------------------------------------------------------

create table if not exists public.fault_report_recipients (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.fault_report_recipients enable row level security;
grant select, insert, update, delete on public.fault_report_recipients to authenticated;

-- A user must be able to see whether THEY are a recipient (drives the "Inkorg" tab); admins
-- manage the whole list.
drop policy if exists fault_report_recipients_select on public.fault_report_recipients;
create policy fault_report_recipients_select on public.fault_report_recipients
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Only admins add/remove/toggle recipients.
drop policy if exists fault_report_recipients_write on public.fault_report_recipients;
create policy fault_report_recipients_write on public.fault_report_recipients
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- SECURITY DEFINER so RLS policies on fault_reports can call it without recursion and every
-- caller reads the same source. STABLE → evaluated ~once per query.
create or replace function public.is_fault_report_recipient() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fault_report_recipients r
    where r.user_id = auth.uid() and r.active
  );
$$;
grant execute on function public.is_fault_report_recipient() to authenticated;

-- ---------------------------------------------------------------------------
-- Fault reports
-- ---------------------------------------------------------------------------

create table if not exists public.fault_reports (
  id             uuid primary key default gen_random_uuid(),
  -- Nullable to match ON DELETE SET NULL (a NOT NULL column + SET NULL would abort profile
  -- deletion). reporter_name is the durable display snapshot (profiles are self-read-only, so
  -- supervisors can't re-read the reporter's name) — mirrors ops_activity_events.actor_name.
  reporter_id    uuid references public.profiles(id) on delete set null,
  reporter_name  text not null,
  category       text not null,
  comment        text not null,
  status         text not null default 'new',
  reply          text,
  responder_id   uuid references public.profiles(id) on delete set null,
  responder_name text,
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint fault_reports_category_chk
    check (category in ('truck', 'lager', 'lastbil', 'isoleringsmaskin', 'maskiner')),
  constraint fault_reports_status_chk
    check (status in ('new', 'in_progress', 'resolved'))
);

create index if not exists fault_reports_reporter_idx on public.fault_reports (reporter_id, created_at desc);
create index if not exists fault_reports_status_idx   on public.fault_reports (status, created_at desc);

alter table public.fault_reports enable row level security;
grant select, insert, update on public.fault_reports to authenticated;

-- Anyone signed in files their own report (reporter_id = auth.uid()).
drop policy if exists fault_reports_insert on public.fault_reports;
create policy fault_reports_insert on public.fault_reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

-- Reporters see their own; supervisors see all.
drop policy if exists fault_reports_select on public.fault_reports;
create policy fault_reports_select on public.fault_reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.is_fault_report_recipient());

-- Only supervisors set status/reply. A matching SELECT policy exists above (UPDATE⇒SELECT rule).
drop policy if exists fault_reports_update on public.fault_reports;
create policy fault_reports_update on public.fault_reports
  for update to authenticated
  using (public.is_fault_report_recipient())
  with check (public.is_fault_report_recipient());

-- ---------------------------------------------------------------------------
-- Seed the arbetsledare (EDIT the emails/ids before running, or manage in admin later).
-- Resolves the two supervisors by email from auth.users. Safe to re-run.
-- ---------------------------------------------------------------------------
-- insert into public.fault_report_recipients (user_id)
-- select id from auth.users where lower(email) in ('arbetsledare1@example.se', 'arbetsledare2@example.se')
-- on conflict (user_id) do update set active = true;
