-- Felanmälan — append-only reply/status history.
--
-- fault_reports.reply/status only ever hold the LATEST value (a supervisor overwrites them each
-- time). This table logs every supervisor update as an immutable row so the ärende shows the full
-- history of replies + status changes over time — not a chat thread, just "what I sent, when".
--
-- The parent fault_reports row keeps the current status + latest reply (for list previews); this
-- table is the timeline. Insert-only: no UPDATE/DELETE policy.
--
-- DEPLOY ORDER: run AFTER 20260703_fault_reports.sql. Run in the Supabase SQL editor. Idempotent.

create table if not exists public.fault_report_updates (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references public.fault_reports(id) on delete cascade,
  -- The status set at this update, and the reply written (nullable — a pure status change logs too).
  status         text not null,
  reply          text,
  responder_id   uuid references public.profiles(id) on delete set null,
  responder_name text not null,
  created_at     timestamptz not null default now(),
  constraint fault_report_updates_status_chk check (status in ('new', 'in_progress', 'resolved'))
);

create index if not exists fault_report_updates_report_idx
  on public.fault_report_updates (report_id, created_at);

alter table public.fault_report_updates enable row level security;
grant select, insert on public.fault_report_updates to authenticated;

-- Read the history if you can read the parent report: the reporter (own report) or a supervisor.
-- The subquery is itself RLS-scoped, so a reporter only matches their own report rows.
drop policy if exists fault_report_updates_select on public.fault_report_updates;
create policy fault_report_updates_select on public.fault_report_updates
  for select to authenticated
  using (
    public.is_fault_report_recipient()
    or exists (select 1 from public.fault_reports fr where fr.id = report_id and fr.reporter_id = auth.uid())
  );

-- Only supervisors append, and only as themselves.
drop policy if exists fault_report_updates_insert on public.fault_report_updates;
create policy fault_report_updates_insert on public.fault_report_updates
  for insert to authenticated
  with check (public.is_fault_report_recipient() and responder_id = auth.uid());
