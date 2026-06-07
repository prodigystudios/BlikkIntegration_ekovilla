-- Allow work orders to exist without an originating quote (standalone orders) — e.g. a
-- quick "customer called and wants the roll" order where no offer was ever created.
-- `drop not null` is a safe no-op if the column is already nullable.

alter table public.crm_work_orders
  alter column quote_id drop not null;
