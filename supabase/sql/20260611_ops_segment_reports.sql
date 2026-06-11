-- Wave 7 slice 3 — per-day sack reporting for the new planning.
--
-- Records how many sacks were blown for a scheduled segment on a given day. The job's "blown
-- total" is the sum across its segments' reports; "kvar" = planned sacks (from the work order's
-- line items) − blown. work_order_id is denormalised from the segment for cheap per-job sums.
--
-- DEPLOY ORDER: run AFTER 20260611_ops_planning_foundation.sql (and the permissions seed). RLS
-- predicates reuse the planning.* keys. Run in the Supabase SQL editor. Idempotent.

create table if not exists public.ops_segment_reports (
  id            uuid primary key default gen_random_uuid(),
  segment_id    uuid not null references public.ops_segments(id) on delete cascade,
  work_order_id uuid not null references public.crm_work_orders(id) on delete cascade,
  report_day    date not null,
  sacks_blown   numeric(10, 2) not null check (sacks_blown >= 0),
  note          text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists ops_segment_reports_segment_idx    on public.ops_segment_reports (segment_id);
create index if not exists ops_segment_reports_work_order_idx on public.ops_segment_reports (work_order_id);

alter table public.ops_segment_reports enable row level security;
grant select, insert, update, delete on public.ops_segment_reports to authenticated;

drop policy if exists ops_segment_reports_select on public.ops_segment_reports;
create policy ops_segment_reports_select on public.ops_segment_reports
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

drop policy if exists ops_segment_reports_insert on public.ops_segment_reports;
create policy ops_segment_reports_insert on public.ops_segment_reports
  for insert to authenticated
  with check (created_by = auth.uid() and public.has_permission('planning.schedule.write'));

drop policy if exists ops_segment_reports_update on public.ops_segment_reports;
create policy ops_segment_reports_update on public.ops_segment_reports
  for update to authenticated
  using (public.has_permission('planning.schedule.write'))
  with check (public.has_permission('planning.schedule.write'));

drop policy if exists ops_segment_reports_delete on public.ops_segment_reports;
create policy ops_segment_reports_delete on public.ops_segment_reports
  for delete to authenticated
  using (public.has_permission('planning.schedule.write'));
