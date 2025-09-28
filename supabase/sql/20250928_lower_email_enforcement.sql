-- Enforce lowercase emails in auth.users
-- Date: 2025-09-28
-- Safe to run multiple times.

-- 1. Normalize existing rows
UPDATE auth.users SET email = lower(email) WHERE email <> lower(email);

-- 2. Ensure unique index on lower(email) (in case default changes later)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='auth' AND indexname='users_email_lower_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX users_email_lower_idx ON auth.users (lower(email));';
  END IF;
END$$;

-- 3. Trigger to force lowercase on insert/update
CREATE OR REPLACE FUNCTION auth.force_lower_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email = lower(NEW.email);
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS force_lower_email ON auth.users;
CREATE TRIGGER force_lower_email
BEFORE INSERT OR UPDATE ON auth.users
FOR EACH ROW EXECUTE PROCEDURE auth.force_lower_email();

-- Verification query (run manually):
--   SELECT email FROM auth.users ORDER BY created_at DESC LIMIT 10;
