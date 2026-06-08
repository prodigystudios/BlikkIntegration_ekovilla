-- Phase 3b of the role→permission migration: crm_quotes + crm_work_orders RLS.
-- Behavior-preserving role→key swaps; ownership (auth.uid() = assigned_to) and the
-- prospect-ownership join are preserved.
--
-- Mapping:
--   role = any(sales,admin,konsult)  (blanket read of all rows)  → has_permission('crm.<res>.read')
--   role in (sales,admin)            (write-self insert)          → has_permission('crm.<res>.write')
--   role = 'admin'                   (manage / update-any / delete-any) → has_permission('crm.admin')
--
-- Run AFTER 20260608_permissions_model.sql. Idempotent.

-- ── crm_quotes ───────────────────────────────────────────────────────────────
-- SELECT: any CRM role reads all quotes; the assigned_to branch keeps installer access.
drop policy if exists "crm_quotes_select_visible" on public.crm_quotes;
create policy "crm_quotes_select_visible"
  on public.crm_quotes
  for select
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.offer.read')
  );

drop policy if exists "crm_quotes_insert_sales_or_admin" on public.crm_quotes;
create policy "crm_quotes_insert_sales_or_admin"
  on public.crm_quotes
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and assigned_to = auth.uid()
    and public.has_permission('crm.offer.write')
    and (
      prospect_id is null
      or exists (
        select 1 from public.crm_prospects prospect
        where prospect.id = prospect_id and prospect.assigned_to = auth.uid()
      )
    )
  );

drop policy if exists "crm_quotes_insert_admin_manage" on public.crm_quotes;
create policy "crm_quotes_insert_admin_manage"
  on public.crm_quotes
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.has_permission('crm.admin')
  );

drop policy if exists "crm_quotes_update_visible" on public.crm_quotes;
create policy "crm_quotes_update_visible"
  on public.crm_quotes
  for update
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  )
  with check (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  );

drop policy if exists "crm_quotes_delete_assigned_or_admin" on public.crm_quotes;
create policy "crm_quotes_delete_assigned_or_admin"
  on public.crm_quotes
  for delete
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  );

-- ── crm_work_orders ──────────────────────────────────────────────────────────
-- SELECT: any CRM role reads all work orders; assigned_to keeps the installer's own jobs.
drop policy if exists "crm_work_orders_select_visible" on public.crm_work_orders;
create policy "crm_work_orders_select_visible"
  on public.crm_work_orders
  for select
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.workorder.read')
  );

drop policy if exists crm_work_orders_insert_sales_or_admin on public.crm_work_orders;
create policy crm_work_orders_insert_sales_or_admin
  on public.crm_work_orders
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and assigned_to = auth.uid()
    and public.has_permission('crm.workorder.write')
  );

drop policy if exists crm_work_orders_insert_admin_manage on public.crm_work_orders;
create policy crm_work_orders_insert_admin_manage
  on public.crm_work_orders
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.has_permission('crm.admin')
  );

drop policy if exists crm_work_orders_update_visible on public.crm_work_orders;
create policy crm_work_orders_update_visible
  on public.crm_work_orders
  for update
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  )
  with check (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  );

drop policy if exists crm_work_orders_delete_assigned_or_admin on public.crm_work_orders;
create policy crm_work_orders_delete_assigned_or_admin
  on public.crm_work_orders
  for delete
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  );
