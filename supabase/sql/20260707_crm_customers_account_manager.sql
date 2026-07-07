-- Kundansvarig (account manager) på crm_customers.
--
-- Ett dedikerat fält, fristående från `assigned_to` (som styr radägarskap/RLS-synlighet
-- och auto-sätts till skaparen). Kundansvarig är den säljare som äger kundrelationen och
-- ska kunna sättas/ändras fritt utan att påverka vem som ser raden.
--
-- Backfillas från Blikk (ansvarig säljare) för företagskunder via kundnummer-matchning
-- (crm_customers.fortnox_customer_id ↔ Blikks kundnummer), men kan också sättas manuellt
-- i kund-UI:t för alla kundtyper.
--
-- FK → profiles(id) (konsekvent med hur assigned_to refererar profiles i quotes/work-orders).
-- on delete set null: en säljare kan sluta utan att kundraden går sönder.
--
-- RLS: ingen policy-ändring behövs. Kolumnen omfattas av de befintliga crm_customers-
-- policyerna (se 20260629_crm_customers_shared_register.sql) — UPDATE tillåts redan för
-- crm.customer.write, och account_manager_id ingår inte i något policy-predikat.

alter table public.crm_customers
  add column if not exists account_manager_id uuid references public.profiles(id) on delete set null;

create index if not exists crm_customers_account_manager_id_idx
  on public.crm_customers (account_manager_id);

comment on column public.crm_customers.account_manager_id is
  'Kundansvarig säljare (FK profiles). Fristående från assigned_to (ägare/RLS-synlighet).';
