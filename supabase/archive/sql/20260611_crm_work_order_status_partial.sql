-- Add the work order status 'partially_invoiced' (label "Delfakturerad"), set by the
-- delfakturering flow when an order has been invoiced in part but not in full. It sits between
-- 'completed' ("Fakturera") and 'invoiced' ("Avslutad") in the lifecycle. System-set only —
-- not offered in the manual status picker.
--
-- The base table's status CHECK constraint name is unknown (created outside this repo), so drop
-- it dynamically — same pattern as 20260607_crm_work_order_status_invoiced.sql. Idempotent.

do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.crm_work_orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.crm_work_orders drop constraint %I', c);
  end loop;

  alter table public.crm_work_orders
    add constraint crm_work_orders_status_check
    check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'partially_invoiced', 'invoiced', 'cancelled'));
end $$;
