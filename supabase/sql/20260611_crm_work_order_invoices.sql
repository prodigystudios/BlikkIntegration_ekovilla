-- Delfakturering (partial invoicing): the app owns the per-article invoiced state because a
-- Fortnox Order carries only ONE InvoiceReference (no per-row invoiced quantity) and its partial
-- invoices can't be reliably listed back via the API. Our DB is the source of truth.
--
-- One row per invoice round on a work order. `line_quantities` records how much of each line
-- item (matched by its position in line_items / the frozen snapshot) was invoiced THAT round.
-- Remaining-per-article = snapshot quantity − sum(line_quantities across rounds).
--
-- Idempotent / safe to re-run.

create table if not exists public.crm_work_order_invoices (
  id                     uuid primary key default gen_random_uuid(),
  work_order_id          uuid not null references public.crm_work_orders(id) on delete cascade,
  round_number           integer not null,                 -- 1,2,3… per work order
  fortnox_invoice_number text,                              -- null until the Fortnox call succeeds
  fortnox_sync_status    text not null default 'pending'
    check (fortnox_sync_status in ('pending', 'synced', 'failed')),
  amount                 numeric(14, 2) not null default 0, -- this round's subtotal, ex VAT (matches pricing_summary.subtotal basis)
  line_quantities        jsonb not null default '[]'::jsonb, -- [{"index":0,"quantity":30}, ...]
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  unique (work_order_id, round_number)
);

create index if not exists crm_wo_invoices_work_order_idx on public.crm_work_order_invoices(work_order_id);

-- Snapshot + marker on the parent. The snapshot freezes line_items at the FIRST partial round so
-- per-article remaining math never drifts (line_items has no stable row id, so rounds match rows
-- by array index — editing is locked from the first round on, see the line-items route guard).
alter table public.crm_work_orders
  add column if not exists line_items_invoicing_snapshot jsonb,
  add column if not exists partial_invoicing_started_at  timestamptz;

alter table public.crm_work_order_invoices enable row level security;

grant select, insert, update, delete on table public.crm_work_order_invoices to authenticated;

-- SELECT mirrors crm_work_orders_select_visible exactly (assigned_to = auth.uid() OR admin),
-- joined through work_order_id. INSERT/UPDATE are written only by server domain code via the
-- admin (service-role) client — the same model as the work order's fortnox_* sync columns — so
-- no session-client insert/update policy is granted.
drop policy if exists crm_wo_invoices_select_visible on public.crm_work_order_invoices;
create policy crm_wo_invoices_select_visible
  on public.crm_work_order_invoices
  for select
  using (
    exists (
      select 1
      from public.crm_work_orders w
      where w.id = work_order_id
        and (
          auth.uid() = w.assigned_to
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'admin'
          )
        )
    )
  );
