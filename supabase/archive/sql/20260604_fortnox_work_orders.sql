-- Add Fortnox sync tracking fields to crm_work_orders

alter table public.crm_work_orders
  add column if not exists fortnox_order_number     text,
  add column if not exists fortnox_order_sync_status text not null default 'not_synced'
    check (fortnox_order_sync_status in ('not_synced', 'pending', 'synced', 'failed')),
  add column if not exists fortnox_order_synced_at  timestamptz;

create index if not exists crm_work_orders_fortnox_order_number_idx
  on public.crm_work_orders (fortnox_order_number)
  where fortnox_order_number is not null;
