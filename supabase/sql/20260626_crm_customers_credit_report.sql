-- Credit report (kreditupplysning) captured on demand from the tic.io LENS API
-- (GET /companies/{id}/risks — Pro tier). Stored as a snapshot on the customer so the
-- pull is explicit/manual and we don't re-bill tic.io on every page view.
-- Company-only fields; nullable. RLS policies on crm_customers already cover these
-- new columns per-row (the manual fetch route writes them server-side).

ALTER TABLE crm_customers
  -- tic.io's numeric internal company id (resolved from org.nr on first fetch, then
  -- reused so a refresh is a single call).
  ADD COLUMN IF NOT EXISTS tic_company_id integer,
  -- Normalized credit report snapshot (credit score, risk class, payment remarks).
  ADD COLUMN IF NOT EXISTS credit_report jsonb,
  -- When the snapshot was fetched (drives the "Hämtad <date>" label + refresh).
  ADD COLUMN IF NOT EXISTS credit_report_fetched_at timestamptz;
