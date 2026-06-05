-- Extend crm_customers with contact info, delivery address, and Fortnox billing fields.
-- RLS policies on crm_customers already cover these new columns per-row.

ALTER TABLE crm_customers
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS mobile text,
  ADD COLUMN IF NOT EXISTS delivery_address jsonb,
  ADD COLUMN IF NOT EXISTS invoice_email text,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS price_list text,
  ADD COLUMN IF NOT EXISTS discount numeric(5,2),
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS reverse_vat boolean NOT NULL DEFAULT false;
