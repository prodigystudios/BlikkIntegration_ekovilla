-- Fix: comment editing on work orders is dead in production.
--
-- 20260606_crm_work_order_edit_policies.sql added an UPDATE *policy*
-- (crm_wo_comments_update_own) on public.crm_work_order_comments, but the table's original
-- grant (20260530064347_crm_work_order_activity.sql) only granted select, insert, delete to
-- `authenticated` — never UPDATE. A row-level policy does nothing without the table-level
-- privilege: PostgreSQL denies the statement ("permission denied for table
-- crm_work_order_comments") before RLS is ever evaluated. So every comment edit
-- (updateCrmWorkOrderComment → PATCH /work-orders/[id]/comments/[commentId]) fails with a 500.
--
-- Grant the missing privilege. The existing crm_wo_comments_update_own policy already scopes
-- UPDATE to the comment's author (created_by = auth.uid()), so this does not widen who can
-- edit — it only makes the already-intended edit actually reachable. (Time entries were never
-- affected: the activity migration granted update there.)

grant update on table public.crm_work_order_comments to authenticated;
