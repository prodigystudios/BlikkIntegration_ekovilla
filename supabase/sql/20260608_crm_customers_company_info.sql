-- Extra company info captured from the tic.io lookup, surfaced in the collapsible
-- "Övrig information" section on the customer form. Company-only fields; nullable.
-- RLS policies on crm_customers already cover these new columns per-row.

ALTER TABLE crm_customers
  -- Bransch & bolagsform
  ADD COLUMN IF NOT EXISTS legal_entity_type text,
  ADD COLUMN IF NOT EXISTS sni_code text,
  ADD COLUMN IF NOT EXISTS sni_name text,
  -- Ekonomi & nyckeltal (belopp i SEK, marginaler i %)
  ADD COLUMN IF NOT EXISTS operating_profit numeric,
  ADD COLUMN IF NOT EXISTS profit_after_financial_items numeric,
  ADD COLUMN IF NOT EXISTS total_assets numeric,
  ADD COLUMN IF NOT EXISTS operating_margin numeric,
  ADD COLUMN IF NOT EXISTS equity_ratio numeric,
  ADD COLUMN IF NOT EXISTS financial_year integer,
  -- Riskindikatorer (tic.io intelligence) som en lista
  ADD COLUMN IF NOT EXISTS risk_indicators jsonb;
