-- Migration: expand employee profile data with self-service fields and admin-managed detail fields.
-- Date: 2026-05-17

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS private_email text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS clothing_size text;

CREATE TABLE IF NOT EXISTS public.employee_profile_details (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  personal_identity_number text,
  job_title text,
  department text,
  manager_name text,
  employment_start_date date,
  employment_type text,
  bank_account_name text,
  bank_clearing_number text,
  bank_account_number text,
  certifications text,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_profile_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_profile_details_select_self ON public.employee_profile_details;
CREATE POLICY employee_profile_details_select_self
  ON public.employee_profile_details
  FOR SELECT
  USING (auth.uid() = user_id);

INSERT INTO public.employee_profile_details (user_id)
SELECT id
FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

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

  RETURN NEW;
END;
$$;