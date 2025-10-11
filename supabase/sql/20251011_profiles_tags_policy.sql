-- Allow service_role to update profiles (explicit policy) to avoid environment-specific RLS issues
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_service_role')
  THEN
    EXECUTE 'CREATE POLICY "profiles_update_service_role" ON public.profiles
      FOR UPDATE
      USING (auth.role() = ''service_role'')
      WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END$$;
