-- Persist company financials captured from the tic.io lookup on the customer form.
-- RLS policies on crm_customers already cover these new columns per-row.

ALTER TABLE crm_customers
  ADD COLUMN IF NOT EXISTS annual_revenue numeric,
  ADD COLUMN IF NOT EXISTS number_of_employees integer;
