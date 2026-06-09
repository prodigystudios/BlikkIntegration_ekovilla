-- Phase 3a of the role→permission migration: swap the ROLE predicates in the core CRM
-- tables' RLS to has_permission(). Behavior-preserving by construction — each role branch is
-- replaced by a permission key whose seed (20260608_permissions_model.sql) admits exactly the
-- same roles the old predicate did. Ownership branches (auth.uid() = assigned_to /
-- user_id = auth.uid() / customer-ownership joins) are left UNTOUCHED.
--
-- Mapping used here:
--   role = 'admin'  (see-all / manage / update-any / delete-any)  → has_permission('crm.admin')
--   role in (sales,admin) (write-self insert)                     → has_permission('crm.<res>.write')
--
-- Tables: crm_calls, crm_customers, crm_customer_contacts, crm_opportunities.
-- NOTE: crm_prospects was dropped (20260604_crm_remove_legacy_prospects.sql) — prospects are
-- now crm_customers with customer_stage='prospect', so crm_calls/quotes reference crm_customers
-- via prospect_id. Reproduces the CURRENT (post-remove-legacy) policies.
-- Run AFTER 20260608_permissions_model.sql. Idempotent (drop+create).

-- ── crm_calls (prospect_id now references crm_customers) ─────────────────────
drop policy if exists "crm_calls_select_visible" on public.crm_calls;
create policy "crm_calls_select_visible"
  on public.crm_calls
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.crm_customers c
      where c.id = prospect_id and c.assigned_to = auth.uid()
    )
    or public.has_permission('crm.admin')
  );

drop policy if exists "crm_calls_insert_visible" on public.crm_calls;
create policy "crm_calls_insert_visible"
  on public.crm_calls
  for insert
  to authenticated
  with check (
    (
      user_id = auth.uid()
      and public.has_permission('crm.call.write')
      and (
        prospect_id is null
        or exists (
          select 1 from public.crm_customers c
          where c.id = prospect_id and c.assigned_to = auth.uid()
        )
      )
    )
    or public.has_permission('crm.admin')
  );

drop policy if exists "crm_calls_update_visible" on public.crm_calls;
create policy "crm_calls_update_visible"
  on public.crm_calls
  for update
  using (
    user_id = auth.uid()
    or public.has_permission('crm.admin')
  )
  with check (
    (
      user_id = auth.uid()
      and public.has_permission('crm.call.write')
      and (
        prospect_id is null
        or exists (
          select 1 from public.crm_customers c
          where c.id = prospect_id and c.assigned_to = auth.uid()
        )
      )
    )
    or public.has_permission('crm.admin')
  );

-- ── crm_customers ────────────────────────────────────────────────────────────
drop policy if exists "crm_customers_select_visible" on public.crm_customers;
create policy "crm_customers_select_visible"
  on public.crm_customers
  for select
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  );

drop policy if exists "crm_customers_insert_sales_or_admin" on public.crm_customers;
create policy "crm_customers_insert_sales_or_admin"
  on public.crm_customers
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.has_permission('crm.customer.write')
  );

drop policy if exists "crm_customers_update_assigned_or_admin" on public.crm_customers;
create policy "crm_customers_update_assigned_or_admin"
  on public.crm_customers
  for update
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  )
  with check (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  );

drop policy if exists "crm_customers_delete_admin" on public.crm_customers;
create policy "crm_customers_delete_admin"
  on public.crm_customers
  for delete
  using (
    public.has_permission('crm.admin')
  );

-- ── crm_customer_contacts (inherit the customer's visibility) ────────────────
-- The admin sub-branch inside the customer-ownership EXISTS becomes has_permission('crm.admin');
-- the c.assigned_to = auth.uid() ownership branch is preserved.
drop policy if exists "crm_customer_contacts_select_visible" on public.crm_customer_contacts;
create policy "crm_customer_contacts_select_visible"
  on public.crm_customer_contacts
  for select
  using (
    exists (
      select 1 from public.crm_customers c
      where c.id = customer_id
        and (c.assigned_to = auth.uid() or public.has_permission('crm.admin'))
    )
  );

drop policy if exists "crm_customer_contacts_insert_sales_or_admin" on public.crm_customer_contacts;
create policy "crm_customer_contacts_insert_sales_or_admin"
  on public.crm_customer_contacts
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.crm_customers c
      where c.id = customer_id
        and (c.assigned_to = auth.uid() or public.has_permission('crm.admin'))
    )
  );

drop policy if exists "crm_customer_contacts_update_sales_or_admin" on public.crm_customer_contacts;
create policy "crm_customer_contacts_update_sales_or_admin"
  on public.crm_customer_contacts
  for update
  using (
    exists (
      select 1 from public.crm_customers c
      where c.id = customer_id
        and (c.assigned_to = auth.uid() or public.has_permission('crm.admin'))
    )
  );

drop policy if exists "crm_customer_contacts_delete_sales_or_admin" on public.crm_customer_contacts;
create policy "crm_customer_contacts_delete_sales_or_admin"
  on public.crm_customer_contacts
  for delete
  using (
    exists (
      select 1 from public.crm_customers c
      where c.id = customer_id
        and (c.assigned_to = auth.uid() or public.has_permission('crm.admin'))
    )
  );

-- ── crm_opportunities ────────────────────────────────────────────────────────
drop policy if exists "crm_opportunities_select_visible" on public.crm_opportunities;
create policy "crm_opportunities_select_visible"
  on public.crm_opportunities
  for select
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  );

drop policy if exists "crm_opportunities_insert_sales_or_admin" on public.crm_opportunities;
create policy "crm_opportunities_insert_sales_or_admin"
  on public.crm_opportunities
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and assigned_to = auth.uid()
    and public.has_permission('crm.opportunity.write')
  );

drop policy if exists "crm_opportunities_insert_admin_manage" on public.crm_opportunities;
create policy "crm_opportunities_insert_admin_manage"
  on public.crm_opportunities
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.has_permission('crm.admin')
  );

drop policy if exists "crm_opportunities_update_visible" on public.crm_opportunities;
create policy "crm_opportunities_update_visible"
  on public.crm_opportunities
  for update
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  )
  with check (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  );

drop policy if exists "crm_opportunities_delete_assigned_or_admin" on public.crm_opportunities;
create policy "crm_opportunities_delete_assigned_or_admin"
  on public.crm_opportunities
  for delete
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.admin')
  );
