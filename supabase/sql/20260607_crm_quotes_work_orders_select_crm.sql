-- Widen read access: any CRM role (sales/admin/konsult) sees ALL quotes and work orders,
-- not only the ones assigned to them — a seller often needs to look up any order/offer for
-- reference or price comparison. Installers (member) keep access only to work orders
-- assigned to them (their jobs). "All / mine / by seller" filtering is done in the app
-- layer on top of this. Idempotent / safe to re-run.

-- ── Quotes ──────────────────────────────────────────────────────────────────
drop policy if exists "crm_quotes_select_visible" on public.crm_quotes;
create policy "crm_quotes_select_visible"
  on public.crm_quotes
  for select
  using (
    auth.uid() = assigned_to
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = any (array['sales', 'admin', 'konsult']::user_role[])
    )
  );

-- ── Work orders ─────────────────────────────────────────────────────────────
-- assigned_to still covers the installer (member) reading their own assigned job.
drop policy if exists "crm_work_orders_select_visible" on public.crm_work_orders;
create policy "crm_work_orders_select_visible"
  on public.crm_work_orders
  for select
  using (
    auth.uid() = assigned_to
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = any (array['sales', 'admin', 'konsult']::user_role[])
    )
  );
