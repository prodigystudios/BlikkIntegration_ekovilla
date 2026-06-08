-- Atomic push-claim timestamps. The CRM pushes documents to Fortnox from application code
-- (offer push, work-order/order push, draft-invoice creation). Two concurrent requests for
-- the same document — a double-clicked button, the auto-push-on-create racing a manual
-- "Skicka till Fortnox", or a retried POST — could each read "no Fortnox number yet" and
-- both create a DUPLICATE Fortnox document.
--
-- claimFortnoxPush() (lib/domains/fortnox/helpers.ts) prevents that with a conditional UPDATE
-- that stamps these columns only when no fresh claim is held. The timestamp lets a stale
-- claim (a crashed/timed-out push) be re-claimed after a timeout, so the guard never
-- permanently deadlocks a document. These columns are written by service-role server code
-- only (same access model as the existing fortnox_* sync columns) — no new policy needed.

alter table public.crm_work_orders
  add column if not exists fortnox_order_claimed_at   timestamptz,
  add column if not exists fortnox_invoice_claimed_at timestamptz;

alter table public.crm_quotes
  add column if not exists fortnox_offer_claimed_at   timestamptz;
