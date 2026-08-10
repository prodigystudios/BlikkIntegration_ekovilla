-- Field cutover fas 1e — track the Blikk mirror of a CRM time entry.
--
-- During the transition, time is entered in CRM (the field view's time tab) and mirrored to Blikk,
-- which is still the system of record for payroll. The mirror is best-effort: a Blikk outage must
-- never fail the CRM insert and lose the person's hours. That makes the two stores capable of
-- drifting, so every row records whether it made it across:
--
--   blikk_time_report_id  not null → mirrored, and this is the Blikk row it became
--                             null → NOT in Blikk yet; payroll would miss these hours
--
-- Reconcile before each payroll run with the query at the bottom of this file. The column is
-- dropped once fas 4 lands (CRM owns payroll) — it exists only for the overlap.
--
-- DEPLOY ORDER: run BEFORE the fas 1 app code (the route writes this column). Idempotent.

alter table public.crm_work_order_time_entries
  add column if not exists blikk_time_report_id bigint;

comment on column public.crm_work_order_time_entries.blikk_time_report_id is
  'Blikk time report id this entry was mirrored to during the CRM cutover. NULL = not mirrored (see supabase/sql/20260810_crm_time_entries_blikk_mirror.sql).';

-- Partial index: the only query that matters is "what has NOT been mirrored", and the unmirrored
-- set should stay small.
create index if not exists crm_work_order_time_entries_unmirrored_idx
  on public.crm_work_order_time_entries (work_date desc)
  where blikk_time_report_id is null;

-- ── Reconciliation (run before payroll) ──────────────────────────────────────
-- Expectation: zero rows. Anything listed was logged in CRM but never reached Blikk — those hours
-- must be entered manually (or re-mirrored) before the payroll run.
--
--   select
--     te.work_date,
--     p.full_name,
--     te.hours,
--     wo.order_number,
--     wo.project_name,
--     te.note
--   from public.crm_work_order_time_entries te
--   join public.profiles p on p.id = te.user_id
--   join public.crm_work_orders wo on wo.id = te.work_order_id
--   where te.blikk_time_report_id is null
--     and te.work_date >= date_trunc('month', current_date)
--   order by te.work_date, p.full_name;
