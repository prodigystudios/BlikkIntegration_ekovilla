-- Add the terminal work order status 'invoiced' (label "Avslutad", set after invoicing)
-- and retire the unused 'ready' value. The base table was created outside this repo
-- (dashboard), so the status CHECK constraint name is unknown — drop it dynamically.
--
-- Existing 'ready' rows (already shown as "Planerad" in the UI) are migrated to
-- 'scheduled' so the tightened constraint applies cleanly. Idempotent / safe to re-run.

do $$
declare
  c text;
begin
  -- Migrate any legacy 'ready' rows before tightening the constraint.
  update public.crm_work_orders set status = 'scheduled' where status = 'ready';

  -- Drop whatever CHECK constraint currently guards the status column.
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.crm_work_orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.crm_work_orders drop constraint %I', c);
  end loop;

  -- Recreate with the current value set: 'invoiced' added, retired 'ready' removed.
  alter table public.crm_work_orders
    add constraint crm_work_orders_status_check
    check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'invoiced', 'cancelled'));
end $$;
