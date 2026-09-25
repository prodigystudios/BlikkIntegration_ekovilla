-- Migration: populate profiles.full_name from auth metadata at signup
-- Date: 2025-09-28
-- Purpose: Ensure profiles.full_name is set even when email confirmation is required (no immediate session),
--          by reading NEW.raw_user_meta_data inside the auth.users trigger.

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
  RETURN NEW;
END;$$;

-- NOTE: Trigger on auth.users already exists; no need to recreate. This is an in-place function replacement.
-- Test (run after creating a new user):
--   select id, full_name, role from public.profiles order by created_at desc limit 5;
