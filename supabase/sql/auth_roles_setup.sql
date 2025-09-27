-- Auth / Role infrastructure for application
-- Run in Supabase SQL Editor. Designed to be (mostly) idempotent.
-- Provides:
--   * user_role enum (member|sales|admin)
--   * profiles table (1:1 with auth.users)
--   * RLS policies (self + admin override)
--   * Automatic profile creation trigger
--   * Secure function for admins to change a user's role
--   * Convenience view for current user role
-- NOTE: Execute the whole script once. Re-running parts is safe except where noted.

-- 1. user_role enum (create if missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('member','sales','admin');
  END IF;
END$$;

-- 2. profiles table (id = auth.users.id)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'member',
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Helpful index (noop if already exists)
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles(role);

-- 3. Enable RLS (safe to run repeatedly)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. Policies (drop+create to allow updates on re-run)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_select_self_or_admin') THEN
    DROP POLICY "profiles_select_self_or_admin" ON public.profiles;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_update_self') THEN
    DROP POLICY "profiles_update_self" ON public.profiles;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_update_admin') THEN
    DROP POLICY "profiles_update_admin" ON public.profiles;
  END IF;
END$$;

-- Replaced recursive select policy (caused infinite recursion) with simple self-only select.
CREATE POLICY "profiles_select_self" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Removed admin update policy relying on recursive subselect. Admin role changes are handled exclusively via set_user_role() SECURITY DEFINER function.

-- (No INSERT policy: rows are inserted via trigger below.)

-- 5. Trigger to auto-create profile after new auth user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING; -- idempotent if trigger recreated
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 6. Admin function to set role
CREATE OR REPLACE FUNCTION public.set_user_role(target uuid, new_role user_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.profiles SET role = new_role WHERE id = target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target user not found';
  END IF;
END;$$;

-- Tighten permissions
REVOKE ALL ON FUNCTION public.set_user_role(uuid, user_role) FROM public;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, user_role) TO authenticated;

-- 7. Convenience view for current user role
CREATE OR REPLACE VIEW public.current_user_role AS
SELECT p.role FROM public.profiles p WHERE p.id = auth.uid();

-- 8. Sample queries (uncomment to test manually)
-- select * from public.profiles where id = auth.uid();
-- select public.set_user_role('00000000-0000-0000-0000-000000000000','sales');
-- select * from public.current_user_role;

-- 9. Manual role assignment fallback (if function not desired):
-- update public.profiles set role='admin' where id='UUID';

-- 10. Rollback helper (ONLY if you need to remove everything):
-- DROP VIEW IF EXISTS public.current_user_role;
-- DROP FUNCTION IF EXISTS public.set_user_role(uuid, user_role);
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- DROP FUNCTION IF EXISTS public.handle_new_user();
-- DROP TABLE IF EXISTS public.profiles;
-- DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname='user_role') THEN DROP TYPE user_role; END IF; END $$;

-- Done.
