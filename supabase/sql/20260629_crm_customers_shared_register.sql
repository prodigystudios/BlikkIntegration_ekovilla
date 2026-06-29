-- Shared customer register. The CRM launches as a single shared book of customers for the
-- whole sales team: every CRM reader must SEE every customer (not just the ones they are
-- assigned to), and every CRM writer must be able to EDIT any customer (a customer record is
-- shared master data — address/phone/org.nr — not an owned deal). This was a product decision
-- at launch (the previous assigned_to-only model left reps unable to see each other's
-- customers and konsult seeing none, and broke the offer form's customer picker).
--
-- This widens crm_customers (and the contacts that inherit its visibility) to the same
-- has_permission(...) shape that crm_quotes / crm_work_orders already use. The assigned_to
-- ownership branch is preserved on SELECT/UPDATE so it never NARROWS access. Writes are still
-- gated by crm.customer.write, so konsult (read-only) stays read-only.
--
-- Behavior change vs 20260609_rls_permissions_crm_core.sql:
--   crm_customers SELECT: assigned_to OR admin            → assigned_to OR crm.customer.read
--   crm_customers UPDATE: assigned_to OR admin            → assigned_to OR crm.customer.write
--   crm_customer_contacts (select/insert/update/delete): customer-owner OR admin
--                                                         → customer-owner OR crm.customer.{read|write}

-- ── crm_customers ──────────────────────────────────────────────────────────────
drop policy if exists "crm_customers_select_visible" on public.crm_customers;
create policy "crm_customers_select_visible"
  on public.crm_customers
  for select
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.customer.read')
  );

drop policy if exists "crm_customers_update_assigned_or_admin" on public.crm_customers;
create policy "crm_customers_update_assigned_or_admin"
  on public.crm_customers
  for update
  using (
    auth.uid() = assigned_to
    or public.has_permission('crm.customer.write')
  )
  with check (
    auth.uid() = assigned_to
    or public.has_permission('crm.customer.write')
  );

-- ── crm_customer_contacts (inherit the customer's widened visibility) ────────────
drop policy if exists "crm_customer_contacts_select_visible" on public.crm_customer_contacts;
create policy "crm_customer_contacts_select_visible"
  on public.crm_customer_contacts
  for select
  using (
    exists (
      select 1 from public.crm_customers c
      where c.id = customer_id
        and (c.assigned_to = auth.uid() or public.has_permission('crm.customer.read'))
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
        and (c.assigned_to = auth.uid() or public.has_permission('crm.customer.write'))
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
        and (c.assigned_to = auth.uid() or public.has_permission('crm.customer.write'))
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
        and (c.assigned_to = auth.uid() or public.has_permission('crm.customer.write'))
    )
  );
