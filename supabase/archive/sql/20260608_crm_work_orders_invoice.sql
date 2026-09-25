-- Track the Fortnox invoice created from a work order. We only create a DRAFT invoice in
-- Fortnox (the actual invoicing/bookkeeping is done by finance inside Fortnox), so these
-- columns just record the reference + sync state. Mirrors the fortnox_order_* columns.

alter table public.crm_work_orders
  add column if not exists fortnox_invoice_number      text,
  add column if not exists fortnox_invoice_sync_status text not null default 'not_synced'
    check (fortnox_invoice_sync_status in ('not_synced', 'pending', 'synced', 'failed')),
  add column if not exists fortnox_invoiced_at         timestamptz;

create index if not exists crm_work_orders_fortnox_invoice_number_idx
  on public.crm_work_orders (fortnox_invoice_number)
  where fortnox_invoice_number is not null;
