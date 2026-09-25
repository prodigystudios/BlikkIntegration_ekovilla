-- Add quote_number as a generated column to crm_quotes.
-- Format: OFF-XXXXXXXX (first 8 hex chars of UUID, uppercased).
-- Example: OFF-A1B2C3D4
--
-- NOTE: to_char(created_at, ...) is not allowed in generated columns because
-- timestamptz → text conversion is timezone-dependent (not immutable).
-- Using only the UUID ensures the expression is fully immutable.

ALTER TABLE crm_quotes
ADD COLUMN quote_number text GENERATED ALWAYS AS (
  'OFF-' || upper(substr(replace(id::text, '-', ''), 1, 8))
) STORED;
