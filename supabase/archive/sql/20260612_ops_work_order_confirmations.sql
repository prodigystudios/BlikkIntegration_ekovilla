-- Wave 7 — new CRM-first planning: order confirmations (orderbekräftelse) sent to the customer.
--
-- Append-only log of confirmations sent for a scheduled job: one row per channel per send. The
-- recipient is resolved from the CRM customer (CRM-first) at send time and snapshotted here. The
-- board reads a per-work-order summary (latest email + latest sms) keyed by work_order_id — the
-- same aggregate-by-work-order pattern as ops_segment_reports — and shows a "bekräftad" badge on
-- every one of the job's cards. segment_id records which placement triggered the send (nullable
-- for durability if that placement is later removed).
--
-- provider_message_id/status capture Twilio's SID + initial status; wiring the delivery-status
-- callback into this table is a later slice (the existing app/api/twilio/sms-status route still
-- targets the old planning_project_meta).
--
-- DEPLOY ORDER: run AFTER 20260611_ops_planning_foundation.sql (FK → ops_segments / crm_work_orders)
-- and 20260611_planning_permissions.sql. Run in the Supabase SQL editor. Idempotent.

create table if not exists public.ops_work_order_confirmations (
  id                  uuid primary key default gen_random_uuid(),
  work_order_id       uuid not null references public.crm_work_orders(id) on delete cascade,
  segment_id          uuid references public.ops_segments(id) on delete set null,
  channel             text not null check (channel in ('email', 'sms')),
  recipient           text not null,
  start_day           date not null,
  end_day             date not null,
  provider_message_id text,
  status              text,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists ops_wo_confirmations_work_order_idx on public.ops_work_order_confirmations (work_order_id, created_at desc);
create index if not exists ops_wo_confirmations_segment_idx    on public.ops_work_order_confirmations (segment_id);

alter table public.ops_work_order_confirmations enable row level security;
grant select, insert, update, delete on public.ops_work_order_confirmations to authenticated;

drop policy if exists ops_wo_confirmations_select on public.ops_work_order_confirmations;
create policy ops_wo_confirmations_select on public.ops_work_order_confirmations
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

drop policy if exists ops_wo_confirmations_insert on public.ops_work_order_confirmations;
create policy ops_wo_confirmations_insert on public.ops_work_order_confirmations
  for insert to authenticated
  with check (created_by = auth.uid() and public.has_permission('planning.schedule.write'));

drop policy if exists ops_wo_confirmations_update on public.ops_work_order_confirmations;
create policy ops_wo_confirmations_update on public.ops_work_order_confirmations
  for update to authenticated
  using (public.has_permission('planning.schedule.write'))
  with check (public.has_permission('planning.schedule.write'));

drop policy if exists ops_wo_confirmations_delete on public.ops_work_order_confirmations;
create policy ops_wo_confirmations_delete on public.ops_work_order_confirmations
  for delete to authenticated
  using (public.has_permission('planning.schedule.write'));
