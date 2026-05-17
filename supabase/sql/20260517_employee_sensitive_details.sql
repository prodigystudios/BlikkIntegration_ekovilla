-- Migration: move personal identity number and bank details into a separate sensitive table.
-- Date: 2026-05-17

CREATE TABLE IF NOT EXISTS public.employee_sensitive_details (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  personal_identity_number text,
  bank_account_name text,
  bank_clearing_number text,
  bank_account_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_sensitive_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_sensitive_details_no_direct_access ON public.employee_sensitive_details;
CREATE POLICY employee_sensitive_details_no_direct_access
  ON public.employee_sensitive_details
  FOR ALL
  USING (false)
  WITH CHECK (false);

INSERT INTO public.employee_sensitive_details (
  user_id,
  personal_identity_number,
  bank_account_name,
  bank_clearing_number,
  bank_account_number
)
SELECT
  user_id,
  personal_identity_number,
  bank_account_name,
  bank_clearing_number,
  bank_account_number
FROM public.employee_profile_details
WHERE personal_identity_number IS NOT NULL
   OR bank_account_name IS NOT NULL
   OR bank_clearing_number IS NOT NULL
   OR bank_account_number IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
SET
  personal_identity_number = EXCLUDED.personal_identity_number,
  bank_account_name = EXCLUDED.bank_account_name,
  bank_clearing_number = EXCLUDED.bank_clearing_number,
  bank_account_number = EXCLUDED.bank_account_number,
  updated_at = now();

ALTER TABLE public.employee_profile_details
  DROP COLUMN IF EXISTS personal_identity_number,
  DROP COLUMN IF EXISTS bank_account_name,
  DROP COLUMN IF EXISTS bank_clearing_number,
  DROP COLUMN IF EXISTS bank_account_number;

INSERT INTO public.employee_sensitive_details (user_id)
SELECT id
FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_employee_sensitive_details_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employee_sensitive_details_set_updated_at ON public.employee_sensitive_details;
CREATE TRIGGER employee_sensitive_details_set_updated_at
BEFORE UPDATE ON public.employee_sensitive_details
FOR EACH ROW EXECUTE FUNCTION public.set_employee_sensitive_details_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'display_name',
    NULL
  );

  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, v_full_name)
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name
    WHERE public.profiles.full_name IS DISTINCT FROM EXCLUDED.full_name;

  INSERT INTO public.employee_profile_details (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.employee_sensitive_details (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;